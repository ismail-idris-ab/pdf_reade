import SecureVaultModule from '../../../modules/secure-vault/src/SecureVaultModule';

/** Contract version reported by the native `secure-vault` module. */
export function getSecureVaultApiVersion(): number {
  return SecureVaultModule.apiVersion;
}
