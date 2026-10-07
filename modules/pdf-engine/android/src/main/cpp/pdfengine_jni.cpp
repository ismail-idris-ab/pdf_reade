// Thin JNI layer over PDFium. PDFium is not thread-safe, so every entry point
// takes the same global lock. Document handles are FPDF_DOCUMENT pointers
// passed to Kotlin as jlong; Kotlin owns their lifetime and must close them.

#include <android/bitmap.h>
#include <jni.h>

#include <cstdio>
#include <mutex>
#include <string>

#include "fpdf_edit.h"
#include "fpdf_ppo.h"
#include "fpdf_save.h"
#include "fpdfview.h"

namespace {

std::mutex g_lock;
bool g_initialized = false;

constexpr const char* kIoException = "java/io/IOException";
constexpr const char* kStateException = "java/lang/IllegalStateException";

void throwJava(JNIEnv* env, const char* clazz, const std::string& message) {
  jclass cls = env->FindClass(clazz);
  if (cls != nullptr) {
    env->ThrowNew(cls, message.c_str());
    env->DeleteLocalRef(cls);
  }
}

// Message format "PDFIUM_ERROR:<code>" is parsed on the Kotlin side.
void throwPdfiumError(JNIEnv* env) {
  throwJava(env, kIoException, "PDFIUM_ERROR:" + std::to_string(FPDF_GetLastError()));
}

// Strings arrive as standard UTF-8 bytes encoded by Kotlin. JNI's own string
// functions use modified UTF-8, which breaks paths containing emoji or other
// characters outside the BMP. Returns false with a Java exception pending.
bool readUtf8(JNIEnv* env, jbyteArray bytes, std::string* out) {
  const jsize length = env->GetArrayLength(bytes);
  out->assign(static_cast<size_t>(length), '\0');
  env->GetByteArrayRegion(bytes, 0, length, reinterpret_cast<jbyte*>(out->data()));
  return !env->ExceptionCheck();
}

FPDF_DOCUMENT asDocument(jlong handle) { return reinterpret_cast<FPDF_DOCUMENT>(handle); }

struct FileWriter : FPDF_FILEWRITE {
  FILE* file;
};

int writeBlock(FPDF_FILEWRITE* self, const void* data, unsigned long size) {
  auto* writer = static_cast<FileWriter*>(self);
  return fwrite(data, 1, size, writer->file) == size ? 1 : 0;
}

}  // namespace

#define JNI_FN(name) Java_com_ismailidris_pdfreader_pdfengine_PdfiumNative_##name

extern "C" {

JNIEXPORT void JNICALL JNI_FN(nativeInit)(JNIEnv*, jobject) {
  std::lock_guard<std::mutex> guard(g_lock);
  if (g_initialized) return;
  FPDF_LIBRARY_CONFIG config{};
  config.version = 2;
  FPDF_InitLibraryWithConfig(&config);
  g_initialized = true;
}

JNIEXPORT jlong JNICALL JNI_FN(nativeOpen)(JNIEnv* env, jobject, jbyteArray path,
                                           jbyteArray password) {
  std::lock_guard<std::mutex> guard(g_lock);
  std::string filePath;
  std::string pass;
  if (!readUtf8(env, path, &filePath)) return 0;
  if (password != nullptr && !readUtf8(env, password, &pass)) return 0;
  FPDF_DOCUMENT doc = FPDF_LoadDocument(filePath.c_str(), password == nullptr ? nullptr : pass.c_str());
  if (doc == nullptr) {
    throwPdfiumError(env);
    return 0;
  }
  return reinterpret_cast<jlong>(doc);
}

JNIEXPORT jlong JNICALL JNI_FN(nativeCreateDocument)(JNIEnv* env, jobject) {
  std::lock_guard<std::mutex> guard(g_lock);
  FPDF_DOCUMENT doc = FPDF_CreateNewDocument();
  if (doc == nullptr) {
    throwJava(env, kStateException, "FPDF_CreateNewDocument failed");
    return 0;
  }
  return reinterpret_cast<jlong>(doc);
}

JNIEXPORT void JNICALL JNI_FN(nativeClose)(JNIEnv*, jobject, jlong handle) {
  std::lock_guard<std::mutex> guard(g_lock);
  if (handle != 0) FPDF_CloseDocument(asDocument(handle));
}

JNIEXPORT jint JNICALL JNI_FN(nativePageCount)(JNIEnv*, jobject, jlong handle) {
  std::lock_guard<std::mutex> guard(g_lock);
  return FPDF_GetPageCount(asDocument(handle));
}

// Returns [widthPt, heightPt].
JNIEXPORT jfloatArray JNICALL JNI_FN(nativePageSize)(JNIEnv* env, jobject, jlong handle, jint index) {
  std::lock_guard<std::mutex> guard(g_lock);
  FS_SIZEF size{};
  if (!FPDF_GetPageSizeByIndexF(asDocument(handle), index, &size)) {
    throwJava(env, kIoException, "Cannot read size of page " + std::to_string(index));
    return nullptr;
  }
  jfloatArray result = env->NewFloatArray(2);
  if (result == nullptr) return nullptr;
  const jfloat values[2] = {size.width, size.height};
  env->SetFloatArrayRegion(result, 0, 2, values);
  return result;
}

// Renders the page scaled to sizeX x sizeY pixels, anchored at the top-left
// of an ARGB_8888 bitmap allocated by Kotlin. PDFium clips whatever falls
// outside the bitmap, so a render size taller than the bitmap crops the
// bottom of the page instead of squashing it.
JNIEXPORT void JNICALL JNI_FN(nativeRenderPage)(JNIEnv* env, jobject, jlong handle, jint index,
                                                jobject bitmap, jint sizeX, jint sizeY) {
  std::lock_guard<std::mutex> guard(g_lock);
  if (sizeX <= 0 || sizeY <= 0) {
    throwJava(env, kStateException, "Render size must be positive");
    return;
  }
  AndroidBitmapInfo info{};
  if (AndroidBitmap_getInfo(env, bitmap, &info) != ANDROID_BITMAP_RESULT_SUCCESS ||
      info.format != ANDROID_BITMAP_FORMAT_RGBA_8888) {
    throwJava(env, kStateException, "Bitmap must be ARGB_8888");
    return;
  }
  FPDF_PAGE page = FPDF_LoadPage(asDocument(handle), index);
  if (page == nullptr) {
    throwPdfiumError(env);
    return;
  }
  void* pixels = nullptr;
  if (AndroidBitmap_lockPixels(env, bitmap, &pixels) != ANDROID_BITMAP_RESULT_SUCCESS) {
    FPDF_ClosePage(page);
    throwJava(env, kStateException, "Cannot lock bitmap pixels");
    return;
  }
  const int width = static_cast<int>(info.width);
  const int height = static_cast<int>(info.height);
  FPDF_BITMAP target =
      FPDFBitmap_CreateEx(width, height, FPDFBitmap_BGRA, pixels, static_cast<int>(info.stride));
  if (target == nullptr) {
    AndroidBitmap_unlockPixels(env, bitmap);
    FPDF_ClosePage(page);
    throwJava(env, kStateException, "FPDFBitmap_CreateEx failed");
    return;
  }
  FPDFBitmap_FillRect(target, 0, 0, width, height, 0xFFFFFFFF);
  // Android stores ARGB_8888 as RGBA bytes; ask PDFium for that order.
  FPDF_RenderPageBitmap(target, page, 0, 0, sizeX, sizeY, 0, FPDF_ANNOT | FPDF_REVERSE_BYTE_ORDER);
  FPDFBitmap_Destroy(target);
  AndroidBitmap_unlockPixels(env, bitmap);
  FPDF_ClosePage(page);
}

// Appends every page of src to the end of dest.
JNIEXPORT void JNICALL JNI_FN(nativeImportAllPages)(JNIEnv* env, jobject, jlong dest, jlong src) {
  std::lock_guard<std::mutex> guard(g_lock);
  FPDF_DOCUMENT destDoc = asDocument(dest);
  if (!FPDF_ImportPages(destDoc, asDocument(src), nullptr, FPDF_GetPageCount(destDoc))) {
    throwJava(env, kIoException, "FPDF_ImportPages failed");
  }
}

JNIEXPORT void JNICALL JNI_FN(nativeSave)(JNIEnv* env, jobject, jlong handle, jbyteArray path) {
  std::lock_guard<std::mutex> guard(g_lock);
  std::string filePath;
  if (!readUtf8(env, path, &filePath)) return;
  FILE* file = fopen(filePath.c_str(), "wb");
  if (file == nullptr) {
    throwJava(env, kIoException, "Cannot open output file");
    return;
  }
  FileWriter writer{};
  writer.version = 1;
  writer.WriteBlock = writeBlock;
  writer.file = file;
  const bool saved = FPDF_SaveAsCopy(asDocument(handle), &writer, FPDF_NO_INCREMENTAL);
  const bool closed = fclose(file) == 0;
  if (!saved || !closed) {
    remove(filePath.c_str());
    throwJava(env, kIoException, "FPDF_SaveAsCopy failed");
  }
}

}  // extern "C"
