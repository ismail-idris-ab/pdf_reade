package com.ismailidris.pdfreader.pdfengine

/**
 * Text of one page plus a normalized [x, y, width, height] per UTF-16 unit,
 * and the page's rotation in degrees for mapping boxes onto the displayed page.
 */
internal class PageTextRects(val text: String, val boxes: DoubleArray, val rotation: Int) {
  fun toMap(): Map<String, Any> = mapOf("text" to text, "boxes" to boxes, "rotation" to rotation)
}

/**
 * Turns PDFium's per-character output into the JS shapes. Pure, no PDFium.
 *
 * FPDFText_GetUnicode returns a wchar_t, which is 32-bit on Android, so one
 * PDFium character can be a code point above U+FFFF. Such a character becomes
 * a surrogate pair and both units carry its box, keeping `text[i]` and
 * `boxes[4i..4i+3]` aligned per UTF-16 unit. Lone surrogate halves PDFium
 * reports pass through unchanged. Unmapped characters (0) and values beyond
 * U+10FFFF become U+FFFD.
 */
internal object PageText {
  /** Values per character in PdfiumNative.textBoxes output, after the geometry header. */
  const val RAW_STRIDE = 5

  /** Appends the UTF-16 unit(s) for one PDFium character value; returns how many. */
  fun appendChar(out: StringBuilder, code: Int): Int = when {
    code in 1..0xFFFF -> {
      out.append(code.toChar())
      1
    }
    code in 0x10000..0x10FFFF -> {
      out.append(Character.highSurrogate(code))
      out.append(Character.lowSurrogate(code))
      2
    }
    else -> {
      out.append(REPLACEMENT)
      1
    }
  }

  fun text(codes: IntArray): String {
    val out = StringBuilder(codes.size)
    for (code in codes) appendChar(out, code)
    return out.toString()
  }

  /**
   * Decodes PdfiumNative.textBoxes output: a [PageGeometry.HEADER_SIZE]
   * geometry header, then [unicode, left, top, right, bottom] per character
   * in user space. Characters without a box, or whose box lies outside the
   * page, get four zeros. Null when the header has no usable page box.
   */
  fun decode(raw: DoubleArray): PageTextRects? {
    val geometry = PageGeometry.decodeHeader(raw) ?: return null
    val body = raw.size - PageGeometry.HEADER_SIZE
    require(body % RAW_STRIDE == 0) { "Malformed text box data" }
    val count = body / RAW_STRIDE
    val text = StringBuilder(count)
    // Worst case every character is a surrogate pair.
    var boxes = DoubleArray(count * 4)
    var units = 0
    for (i in 0 until count) {
      val at = PageGeometry.HEADER_SIZE + i * RAW_STRIDE
      val added = appendChar(text, raw[at].toInt())
      if (units + added > boxes.size / 4) boxes = boxes.copyOf(maxOf(boxes.size * 2, (units + added) * 4))
      val rect = PageGeometry.normalize(geometry.box, raw[at + 1], raw[at + 2], raw[at + 3], raw[at + 4])
      repeat(added) {
        if (rect != null) {
          boxes[units * 4] = rect.x
          boxes[units * 4 + 1] = rect.y
          boxes[units * 4 + 2] = rect.width
          boxes[units * 4 + 3] = rect.height
        }
        units++
      }
    }
    return PageTextRects(text.toString(), if (boxes.size == units * 4) boxes else boxes.copyOf(units * 4), geometry.rotation)
  }

  private const val REPLACEMENT = '�'
}
