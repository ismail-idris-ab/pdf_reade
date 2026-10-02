package com.ismailidris.pdfreader.pdfengine

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PdfEngineModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PdfEngine")

    // Version of the JS-facing contract, exposed for diagnostics. Bump it
    // whenever the module API changes.
    Constant("apiVersion") {
      API_VERSION
    }
  }

  companion object {
    const val API_VERSION = 1
  }
}
