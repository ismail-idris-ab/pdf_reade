cmake_minimum_required(VERSION 3.22.1)
project(pdfengine CXX)

if(NOT PDFIUM_DIR)
  message(FATAL_ERROR "PDFIUM_DIR is not set; the fetchPdfium Gradle task provides it")
endif()

set(PDFIUM_ABI_DIR "${PDFIUM_DIR}/${ANDROID_ABI}")

add_library(pdfium SHARED IMPORTED)
set_target_properties(pdfium PROPERTIES
  IMPORTED_LOCATION "${PDFIUM_ABI_DIR}/lib/libpdfium.so"
  INTERFACE_INCLUDE_DIRECTORIES "${PDFIUM_ABI_DIR}/include")

add_library(pdfengine SHARED pdfengine_jni.cpp)
set_target_properties(pdfengine PROPERTIES CXX_STANDARD 17 CXX_STANDARD_REQUIRED ON)
target_compile_options(pdfengine PRIVATE -Wall -Wextra -Werror -fvisibility=hidden)
# 16 KB page-size support (Google Play requirement for native code).
target_link_options(pdfengine PRIVATE "-Wl,-z,max-page-size=16384")
target_link_libraries(pdfengine PRIVATE pdfium jnigraphics log)
