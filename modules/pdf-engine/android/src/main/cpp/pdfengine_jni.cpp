// Thin JNI layer over PDFium. PDFium is not thread-safe, so every entry point
// takes the same global lock. Document handles are FPDF_DOCUMENT pointers
// passed to Kotlin as jlong; Kotlin owns their lifetime and must close them.
// Bookmark handles are pointers owned by their document and are only valid
// while it is open.
//
// Every page, text page and search handle opened here is released before the
// entry point returns, on every path (RAII holders below). Results are
// returned in PDF user space; conversion to normalized page space happens in
// Kotlin (PageGeometry).

#include <android/bitmap.h>
#include <jni.h>

#include <atomic>
#include <limits>
#include <mutex>
#include <new>
#include <string>
#include <vector>

#include "fpdf_doc.h"
#include "fpdf_edit.h"
#include "fpdf_progressive.h"
#include "fpdf_text.h"
#include "fpdfview.h"

namespace {

std::mutex g_lock;
bool g_initialized = false;

constexpr const char* kIoException = "java/io/IOException";
constexpr const char* kStateException = "java/lang/IllegalStateException";
constexpr const char* kOutOfMemoryError = "java/lang/OutOfMemoryError";
constexpr double kNaN = std::numeric_limits<double>::quiet_NaN();

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

// A page or its text layer could not be loaded. FPDF_LoadPage does not set
// FPDF_GetLastError, so report it as FPDF_ERR_PAGE for Kotlin to map.
void throwPageError(JNIEnv* env) {
  throwJava(env, kIoException, "PDFIUM_ERROR:" + std::to_string(FPDF_ERR_PAGE));
}

void throwOutOfMemory(JNIEnv* env) { throwJava(env, kOutOfMemoryError, "Native allocation failed"); }

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

FPDF_BOOKMARK asBookmark(jlong handle) { return reinterpret_cast<FPDF_BOOKMARK>(handle); }

class PageHolder {
 public:
  PageHolder(FPDF_DOCUMENT doc, int index) : page_(FPDF_LoadPage(doc, index)) {}
  ~PageHolder() {
    if (page_ != nullptr) FPDF_ClosePage(page_);
  }
  PageHolder(const PageHolder&) = delete;
  PageHolder& operator=(const PageHolder&) = delete;
  FPDF_PAGE get() const { return page_; }

 private:
  FPDF_PAGE page_;
};

// Declare after the PageHolder it reads from so it is destroyed first.
class TextPageHolder {
 public:
  explicit TextPageHolder(FPDF_PAGE page) : text_(page == nullptr ? nullptr : FPDFText_LoadPage(page)) {}
  ~TextPageHolder() {
    if (text_ != nullptr) FPDFText_ClosePage(text_);
  }
  TextPageHolder(const TextPageHolder&) = delete;
  TextPageHolder& operator=(const TextPageHolder&) = delete;
  FPDF_TEXTPAGE get() const { return text_; }

 private:
  FPDF_TEXTPAGE text_;
};

class SearchHolder {
 public:
  SearchHolder(FPDF_TEXTPAGE text, FPDF_WIDESTRING query, unsigned long flags)
      : search_(FPDFText_FindStart(text, query, flags, 0)) {}
  ~SearchHolder() {
    if (search_ != nullptr) FPDFText_FindClose(search_);
  }
  SearchHolder(const SearchHolder&) = delete;
  SearchHolder& operator=(const SearchHolder&) = delete;
  FPDF_SCHHANDLE get() const { return search_; }

 private:
  FPDF_SCHHANDLE search_;
};

// Cancellation flag for one progressive render. Created and freed from Kotlin
// (RenderCancelToken), which guarantees a cancel never races with the free.
// Set without g_lock: the render it stops is holding that lock.
struct CancelToken {
  std::atomic<bool> cancelled{false};
};

CancelToken* asToken(jlong handle) { return reinterpret_cast<CancelToken*>(handle); }

bool isCancelled(const CancelToken* token) { return token->cancelled.load(std::memory_order_acquire); }

// IFSDK_PAUSE callback: PDFium asks between batches of page objects whether to
// stop; a cancelled token stops it.
FPDF_BOOL needToPauseNow(IFSDK_PAUSE* pause) {
  return isCancelled(static_cast<const CancelToken*>(pause->user)) ? 1 : 0;
}

// Keeps an Android bitmap's pixels locked until unlock() or destruction. JNI
// calls must not run with a Java exception pending, so every path that throws
// while locked calls unlock() first.
class PixelLock {
 public:
  PixelLock(JNIEnv* env, jobject bitmap) : env_(env), bitmap_(bitmap) {
    locked_ = AndroidBitmap_lockPixels(env, bitmap, &pixels_) == ANDROID_BITMAP_RESULT_SUCCESS;
  }
  ~PixelLock() { unlock(); }
  void unlock() {
    if (locked_) AndroidBitmap_unlockPixels(env_, bitmap_);
    locked_ = false;
  }
  PixelLock(const PixelLock&) = delete;
  PixelLock& operator=(const PixelLock&) = delete;
  void* pixels() const { return locked_ ? pixels_ : nullptr; }

 private:
  JNIEnv* env_;
  jobject bitmap_;
  void* pixels_ = nullptr;
  bool locked_ = false;
};

// Declare after the PixelLock whose pixels it wraps so it is destroyed first.
class BitmapHolder {
 public:
  BitmapHolder(int width, int height, void* pixels, int stride)
      : bitmap_(FPDFBitmap_CreateEx(width, height, FPDFBitmap_BGRA, pixels, stride)) {}
  ~BitmapHolder() {
    if (bitmap_ != nullptr) FPDFBitmap_Destroy(bitmap_);
  }
  BitmapHolder(const BitmapHolder&) = delete;
  BitmapHolder& operator=(const BitmapHolder&) = delete;
  FPDF_BITMAP get() const { return bitmap_; }

 private:
  FPDF_BITMAP bitmap_;
};

// Ends a progressive render (frees its context) before the page closes.
// Declare after the PageHolder so it is destroyed first.
class ProgressiveRenderCloser {
 public:
  explicit ProgressiveRenderCloser(FPDF_PAGE page) : page_(page) {}
  ~ProgressiveRenderCloser() { FPDF_RenderPage_Close(page_); }
  ProgressiveRenderCloser(const ProgressiveRenderCloser&) = delete;
  ProgressiveRenderCloser& operator=(const ProgressiveRenderCloser&) = delete;

 private:
  FPDF_PAGE page_;
};

// Results of nativeRenderPageProgressive; mirrored in PdfiumNative.
constexpr jint kRenderDone = 0;
constexpr jint kRenderCancelled = 1;
constexpr jint kRenderFailed = 2;

// Shared by thumbnails and the page view: annotations drawn, RGBA byte order
// (Android stores ARGB_8888 as RGBA bytes).
constexpr int kRenderFlags = FPDF_ANNOT | FPDF_REVERSE_BYTE_ORDER;

// Number of leading doubles appendPageGeometry writes.
constexpr size_t kGeometryHeader = 5;

// Appends [left, bottom, right, top, rotation] for a loaded page: the crop box
// clipped to the media box in user space, then FPDFPage_GetRotation's quarter
// turns (0-3, -1 unknown). False when PDFium has no box for the page.
bool appendPageGeometry(FPDF_PAGE page, std::vector<double>* out) {
  FS_RECTF box{};
  if (!FPDF_GetPageBoundingBox(page, &box)) return false;
  out->insert(out->end(), {box.left, box.bottom, box.right, box.top,
                           static_cast<double>(FPDFPage_GetRotation(page))});
  return true;
}

// Copies values into a new Java double[]; null with an exception pending on failure.
jdoubleArray toJava(JNIEnv* env, const std::vector<double>& values) {
  const auto size = static_cast<jsize>(values.size());
  jdoubleArray result = env->NewDoubleArray(size);
  if (result == nullptr) return nullptr;
  if (size > 0) env->SetDoubleArrayRegion(result, 0, size, values.data());
  return result;
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

JNIEXPORT void JNICALL JNI_FN(nativeClose)(JNIEnv*, jobject, jlong handle) {
  std::lock_guard<std::mutex> guard(g_lock);
  if (handle != 0) FPDF_CloseDocument(asDocument(handle));
}

JNIEXPORT jint JNICALL JNI_FN(nativePageCount)(JNIEnv*, jobject, jlong handle) {
  std::lock_guard<std::mutex> guard(g_lock);
  return FPDF_GetPageCount(asDocument(handle));
}

// -1 when the document has no security handler.
JNIEXPORT jint JNICALL JNI_FN(nativeSecurityHandlerRevision)(JNIEnv*, jobject, jlong handle) {
  std::lock_guard<std::mutex> guard(g_lock);
  return FPDF_GetSecurityHandlerRevision(asDocument(handle));
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

// Displayed sizes of pages [start, start + count): two doubles per page,
// [width, height] in points with /Rotate applied, NaN when the page has no
// valid dictionary. Uses FPDF_GetPageSizeByIndexF, which (chromium/8076,
// fpdf_view.cpp) builds a CPDF_Page whose constructor only computes
// dimensions; unlike FPDF_LoadPage it never calls ParseContent, so this stays
// cheap for any page count. Kotlin validates start and count.
JNIEXPORT jdoubleArray JNICALL JNI_FN(nativePageSizes)(JNIEnv* env, jobject, jlong handle, jint start,
                                                       jint count) {
  std::lock_guard<std::mutex> guard(g_lock);
  if (count < 0) return toJava(env, {});
  try {
    std::vector<double> out;
    out.reserve(static_cast<size_t>(count) * 2);
    FPDF_DOCUMENT doc = asDocument(handle);
    for (int index = start; index < start + count; ++index) {
      FS_SIZEF size{};
      if (FPDF_GetPageSizeByIndexF(doc, index, &size)) {
        out.insert(out.end(), {size.width, size.height});
      } else {
        out.insert(out.end(), {kNaN, kNaN});
      }
    }
    return toJava(env, out);
  } catch (const std::bad_alloc&) {
    throwOutOfMemory(env);
    return nullptr;
  }
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
    // FPDF_GetLastError is not set by FPDF_LoadPage and would be stale here.
    throwPageError(env);
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
  FPDF_RenderPageBitmap(target, page, 0, 0, sizeX, sizeY, 0, kRenderFlags);
  FPDFBitmap_Destroy(target);
  AndroidBitmap_unlockPixels(env, bitmap);
  FPDF_ClosePage(page);
}

JNIEXPORT jlong JNICALL JNI_FN(nativeNewCancelToken)(JNIEnv* env, jobject) {
  auto* token = new (std::nothrow) CancelToken();
  if (token == nullptr) throwOutOfMemory(env);
  return reinterpret_cast<jlong>(token);
}

// No g_lock: it must reach a render that is holding the lock.
JNIEXPORT void JNICALL JNI_FN(nativeCancelToken)(JNIEnv*, jobject, jlong token) {
  if (token != 0) asToken(token)->cancelled.store(true, std::memory_order_release);
}

JNIEXPORT void JNICALL JNI_FN(nativeFreeCancelToken)(JNIEnv*, jobject, jlong token) {
  delete asToken(token);
}

// Renders the page over an ARGB_8888 bitmap (sizeX x sizeY, top-left anchored,
// white paper first) with PDFium's progressive renderer, which asks the token
// between batches of page objects whether to stop. rotate is 0 because PDFium
// adds the page's own /Rotate itself (CPDF_Page::GetDisplayMatrix), so the
// output is in displayed orientation (checked by PageRenderServiceTest).
// Returns kRenderDone, kRenderCancelled (stopped early; pixels are partial)
// or kRenderFailed. A page that cannot be loaded throws
// PDFIUM_ERROR:FPDF_ERR_PAGE. The page, progressive context, FPDF bitmap and
// pixel lock are released on every path.
JNIEXPORT jint JNICALL JNI_FN(nativeRenderPageProgressive)(JNIEnv* env, jobject, jlong handle, jint index,
                                                           jobject bitmap, jint sizeX, jint sizeY,
                                                           jlong token) {
  std::lock_guard<std::mutex> guard(g_lock);
  if (sizeX <= 0 || sizeY <= 0 || token == 0) {
    throwJava(env, kStateException, "Invalid render request");
    return kRenderFailed;
  }
  const CancelToken* cancel = asToken(token);
  if (isCancelled(cancel)) return kRenderCancelled;
  AndroidBitmapInfo info{};
  if (AndroidBitmap_getInfo(env, bitmap, &info) != ANDROID_BITMAP_RESULT_SUCCESS ||
      info.format != ANDROID_BITMAP_FORMAT_RGBA_8888) {
    throwJava(env, kStateException, "Bitmap must be ARGB_8888");
    return kRenderFailed;
  }
  PageHolder page(asDocument(handle), index);
  if (page.get() == nullptr) {
    // FPDF_GetLastError is not set by FPDF_LoadPage and would be stale here.
    throwPageError(env);
    return kRenderFailed;
  }
  PixelLock pixels(env, bitmap);
  if (pixels.pixels() == nullptr) {
    throwJava(env, kStateException, "Cannot lock bitmap pixels");
    return kRenderFailed;
  }
  const int width = static_cast<int>(info.width);
  const int height = static_cast<int>(info.height);
  BitmapHolder target(width, height, pixels.pixels(), static_cast<int>(info.stride));
  if (target.get() == nullptr) {
    pixels.unlock();
    throwJava(env, kStateException, "FPDFBitmap_CreateEx failed");
    return kRenderFailed;
  }
  FPDFBitmap_FillRect(target.get(), 0, 0, width, height, 0xFFFFFFFF);
  IFSDK_PAUSE pause{};
  pause.version = 1;
  pause.NeedToPauseNow = needToPauseNow;
  pause.user = const_cast<CancelToken*>(cancel);
  ProgressiveRenderCloser closer(page.get());
  int status =
      FPDF_RenderPageBitmap_Start(target.get(), page.get(), 0, 0, sizeX, sizeY, 0, kRenderFlags, &pause);
  // TOBECONTINUED only follows a pause, and pauses only follow a cancel; the
  // check keeps a spurious pause from ending the render.
  while (status == FPDF_RENDER_TOBECONTINUED && !isCancelled(cancel)) {
    status = FPDF_RenderPage_Continue(page.get(), &pause);
  }
  if (status == FPDF_RENDER_DONE) return kRenderDone;
  if (status == FPDF_RENDER_TOBECONTINUED) return kRenderCancelled;
  return kRenderFailed;
}

// The Unicode value of every character of the page, by PDFium character
// index (FPDFText_GetUnicode; 0 when PDFium has no mapping). Using the
// per-index value keeps the text aligned with nativeTextBoxes, which
// FPDFText_GetText does not guarantee.
JNIEXPORT jintArray JNICALL JNI_FN(nativePageChars)(JNIEnv* env, jobject, jlong handle, jint index) {
  std::lock_guard<std::mutex> guard(g_lock);
  PageHolder page(asDocument(handle), index);
  TextPageHolder text(page.get());
  if (text.get() == nullptr) {
    throwPageError(env);
    return nullptr;
  }
  const int count = FPDFText_CountChars(text.get());
  if (count < 0) {
    throwPageError(env);
    return nullptr;
  }
  jintArray result = env->NewIntArray(count);
  if (result == nullptr) return nullptr;
  if (count == 0) return result;
  jint* codes = env->GetIntArrayElements(result, nullptr);
  if (codes == nullptr) return nullptr;
  for (int i = 0; i < count; ++i) {
    codes[i] = static_cast<jint>(FPDFText_GetUnicode(text.get(), i));
  }
  env->ReleaseIntArrayElements(result, codes, 0);
  return result;
}

// The page geometry (see appendPageGeometry), then five doubles per
// character: [unicode, left, top, right, bottom] in user space. Uses FPDFText_GetLooseCharBox: it spans the font's full ascent and
// descent, so boxes on a line share a height and spaces get a width, which is
// what selection hit-testing and highlighting need (GetCharBox is the tight
// glyph outline: tiny for '.', empty for spaces). Characters PDFium generated
// (inserted spaces, line breaks) or without a box get NaN coordinates.
JNIEXPORT jdoubleArray JNICALL JNI_FN(nativeTextBoxes)(JNIEnv* env, jobject, jlong handle, jint index) {
  std::lock_guard<std::mutex> guard(g_lock);
  PageHolder page(asDocument(handle), index);
  TextPageHolder text(page.get());
  if (text.get() == nullptr) {
    throwPageError(env);
    return nullptr;
  }
  const int count = FPDFText_CountChars(text.get());
  if (count < 0) {
    throwPageError(env);
    return nullptr;
  }
  try {
    std::vector<double> out;
    out.reserve(kGeometryHeader + static_cast<size_t>(count) * 5);
    if (!appendPageGeometry(page.get(), &out)) {
      throwPageError(env);
      return nullptr;
    }
    for (int i = 0; i < count; ++i) {
      const double code = static_cast<double>(FPDFText_GetUnicode(text.get(), i));
      FS_RECTF box{};
      if (FPDFText_IsGenerated(text.get(), i) != 1 && FPDFText_GetLooseCharBox(text.get(), i, &box)) {
        out.insert(out.end(), {code, box.left, box.top, box.right, box.bottom});
      } else {
        out.insert(out.end(), {code, kNaN, kNaN, kNaN, kNaN});
      }
    }
    return toJava(env, out);
  } catch (const std::bad_alloc&) {
    throwOutOfMemory(env);
    return nullptr;
  }
}

// Finds up to maxMatches occurrences of query (UTF-16, no terminator) on one
// page. Layout: the page geometry (see appendPageGeometry), then [matchCount,
// then per match: rectCount, then rectCount x
// (left, top, right, bottom) in user space]. Rects come from
// FPDFText_CountRects/GetRect over the match's character range, so a match
// that wraps lines has several.
JNIEXPORT jdoubleArray JNICALL JNI_FN(nativeSearchPage)(JNIEnv* env, jobject, jlong handle, jint index,
                                                        jcharArray query, jint flags, jint maxMatches) {
  std::lock_guard<std::mutex> guard(g_lock);
  try {
    const jsize length = env->GetArrayLength(query);
    // FPDF_WIDESTRING is NUL-terminated UTF-16LE; jchar is UTF-16 in native
    // (little-endian on every Android ABI) byte order.
    std::vector<FPDF_WCHAR> needle(static_cast<size_t>(length) + 1, 0);
    env->GetCharArrayRegion(query, 0, length, reinterpret_cast<jchar*>(needle.data()));
    if (env->ExceptionCheck()) return nullptr;

    PageHolder page(asDocument(handle), index);
    TextPageHolder text(page.get());
    if (text.get() == nullptr) {
      throwPageError(env);
      return nullptr;
    }
    std::vector<double> out;
    if (!appendPageGeometry(page.get(), &out)) {
      throwPageError(env);
      return nullptr;
    }
    out.push_back(0.0);
    if (length == 0 || maxMatches <= 0 || FPDFText_CountChars(text.get()) <= 0) return toJava(env, out);
    SearchHolder search(text.get(), needle.data(), static_cast<unsigned long>(flags));
    if (search.get() == nullptr) return toJava(env, out);
    int matches = 0;
    while (matches < maxMatches && FPDFText_FindNext(search.get())) {
      const int first = FPDFText_GetSchResultIndex(search.get());
      const int chars = FPDFText_GetSchCount(search.get());
      const int rects = chars > 0 ? FPDFText_CountRects(text.get(), first, chars) : 0;
      out.push_back(static_cast<double>(rects > 0 ? rects : 0));
      for (int r = 0; r < rects; ++r) {
        double left = 0;
        double top = 0;
        double right = 0;
        double bottom = 0;
        FPDFText_GetRect(text.get(), r, &left, &top, &right, &bottom);
        out.insert(out.end(), {left, top, right, bottom});
      }
      ++matches;
    }
    out[kGeometryHeader] = static_cast<double>(matches);
    return toJava(env, out);
  } catch (const std::bad_alloc&) {
    throwOutOfMemory(env);
    return nullptr;
  }
}

// First child of bookmark (0 = the outline root), or 0 when there is none.
JNIEXPORT jlong JNICALL JNI_FN(nativeBookmarkFirstChild)(JNIEnv*, jobject, jlong handle, jlong bookmark) {
  std::lock_guard<std::mutex> guard(g_lock);
  return reinterpret_cast<jlong>(FPDFBookmark_GetFirstChild(asDocument(handle), asBookmark(bookmark)));
}

// Next sibling of bookmark, or 0. Malformed files can make this cycle; the
// Kotlin walker tracks visited handles.
JNIEXPORT jlong JNICALL JNI_FN(nativeBookmarkNextSibling)(JNIEnv*, jobject, jlong handle, jlong bookmark) {
  std::lock_guard<std::mutex> guard(g_lock);
  if (bookmark == 0) return 0;
  return reinterpret_cast<jlong>(FPDFBookmark_GetNextSibling(asDocument(handle), asBookmark(bookmark)));
}

// The bookmark title as UTF-16 code units (no terminator).
JNIEXPORT jcharArray JNICALL JNI_FN(nativeBookmarkTitle)(JNIEnv* env, jobject, jlong bookmark) {
  std::lock_guard<std::mutex> guard(g_lock);
  if (bookmark == 0) return env->NewCharArray(0);
  try {
    // Byte length including the two-byte NUL terminator.
    const unsigned long bytes = FPDFBookmark_GetTitle(asBookmark(bookmark), nullptr, 0);
    const unsigned long units = bytes / 2;
    if (units <= 1) return env->NewCharArray(0);
    std::vector<FPDF_WCHAR> buffer(units, 0);
    FPDFBookmark_GetTitle(asBookmark(bookmark), buffer.data(), units * 2);
    const auto length = static_cast<jsize>(units - 1);
    jcharArray result = env->NewCharArray(length);
    if (result == nullptr) return nullptr;
    env->SetCharArrayRegion(result, 0, length, reinterpret_cast<const jchar*>(buffer.data()));
    return result;
  } catch (const std::bad_alloc&) {
    throwOutOfMemory(env);
    return nullptr;
  }
}

// 0-based page targeted by the bookmark's destination, or by its GoTo
// action's destination; -1 when it has neither (URI, launch, remote GoTo...).
JNIEXPORT jint JNICALL JNI_FN(nativeBookmarkPage)(JNIEnv*, jobject, jlong handle, jlong bookmark) {
  std::lock_guard<std::mutex> guard(g_lock);
  if (bookmark == 0) return -1;
  FPDF_DOCUMENT doc = asDocument(handle);
  FPDF_DEST dest = FPDFBookmark_GetDest(doc, asBookmark(bookmark));
  if (dest == nullptr) {
    FPDF_ACTION action = FPDFBookmark_GetAction(asBookmark(bookmark));
    if (action != nullptr && FPDFAction_GetType(action) == PDFACTION_GOTO) {
      dest = FPDFAction_GetDest(doc, action);
    }
  }
  if (dest == nullptr) return -1;
  return FPDFDest_GetDestPageIndex(doc, dest);
}

}  // extern "C"
