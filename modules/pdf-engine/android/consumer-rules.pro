# PdfBox-Android references the optional jp2-android codec for JPEG 2000
# (JPX) streams. We do not bundle it: PDFium renders JPX images itself, and
# PdfBox is only used for writes.
-dontwarn com.gemalto.jp2.**
