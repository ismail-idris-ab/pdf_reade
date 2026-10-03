package com.ismailidris.pdfreader.pdfengine

import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PdfEngineModule : Module() {
  private val spike by lazy {
    EngineSpike(appContext.reactContext ?: throw Exceptions.ReactContextLost())
  }

  override fun definition() = ModuleDefinition {
    Name("PdfEngine")

    // Version of the JS-facing contract, exposed for diagnostics. Bump it
    // whenever the module API changes.
    Constant("apiVersion") {
      API_VERSION
    }

    // T0.1b spike functions, registered in debug builds only. Removed when
    // T2.1 defines the engine API.
    if (BuildConfig.DEBUG) {
      AsyncFunction("spikeRender") {
        spike.render()
      }

      AsyncFunction("spikeMerge") {
        spike.merge()
      }
    }
  }

  companion object {
    const val API_VERSION = 1
  }
}
