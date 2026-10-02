package com.ismailidris.pdfreader.securevault

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SecureVaultModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SecureVault")

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
