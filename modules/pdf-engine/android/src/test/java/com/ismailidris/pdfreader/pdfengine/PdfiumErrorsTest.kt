package com.ismailidris.pdfreader.pdfengine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PdfiumErrorsTest {
  @Test
  fun parsesPdfiumErrorMessages() {
    assertEquals(4, PdfiumErrors.parseCode("PDFIUM_ERROR:4"))
    assertEquals(0, PdfiumErrors.parseCode("PDFIUM_ERROR:0"))
    assertEquals(12, PdfiumErrors.parseCode("PDFIUM_ERROR:12"))
  }

  @Test
  fun ignoresOtherMessages() {
    assertNull(PdfiumErrors.parseCode(null))
    assertNull(PdfiumErrors.parseCode(""))
    assertNull(PdfiumErrors.parseCode("Cannot read size of page 0"))
    assertNull(PdfiumErrors.parseCode("PDFIUM_ERROR:"))
    assertNull(PdfiumErrors.parseCode("PDFIUM_ERROR:abc"))
    assertNull(PdfiumErrors.parseCode("x PDFIUM_ERROR:4"))
  }

  @Test
  fun mapsPasswordFormatPageAndSecurity() {
    assertEquals(ErrorCode.PASSWORD_REQUIRED, PdfiumErrors.errorCodeFor(PdfiumErrors.FPDF_ERR_PASSWORD, true))
    assertEquals(ErrorCode.CORRUPT_FILE, PdfiumErrors.errorCodeFor(PdfiumErrors.FPDF_ERR_FORMAT, true))
    assertEquals(ErrorCode.CORRUPT_FILE, PdfiumErrors.errorCodeFor(PdfiumErrors.FPDF_ERR_PAGE, true))
    assertEquals(ErrorCode.UNSUPPORTED, PdfiumErrors.errorCodeFor(PdfiumErrors.FPDF_ERR_SECURITY, true))
  }

  @Test
  fun fileErrorDependsOnWhetherTheFileExists() {
    assertEquals(ErrorCode.NOT_FOUND, PdfiumErrors.errorCodeFor(PdfiumErrors.FPDF_ERR_FILE, false))
    assertEquals(ErrorCode.CORRUPT_FILE, PdfiumErrors.errorCodeFor(PdfiumErrors.FPDF_ERR_FILE, true))
  }

  @Test
  fun unknownAndUnexpectedCodesHaveNoSharedCode() {
    assertNull(PdfiumErrors.errorCodeFor(PdfiumErrors.FPDF_ERR_UNKNOWN, true))
    assertNull(PdfiumErrors.errorCodeFor(PdfiumErrors.FPDF_ERR_SUCCESS, true))
    assertNull(PdfiumErrors.errorCodeFor(99, false))
  }

  @Test
  fun constantsMatchFpdfview() {
    assertEquals(listOf(0, 1, 2, 3, 4, 5, 6), listOf(
      PdfiumErrors.FPDF_ERR_SUCCESS,
      PdfiumErrors.FPDF_ERR_UNKNOWN,
      PdfiumErrors.FPDF_ERR_FILE,
      PdfiumErrors.FPDF_ERR_FORMAT,
      PdfiumErrors.FPDF_ERR_PASSWORD,
      PdfiumErrors.FPDF_ERR_SECURITY,
      PdfiumErrors.FPDF_ERR_PAGE,
    ))
  }
}
