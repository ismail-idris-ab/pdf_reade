import { NativeModule, requireNativeModule } from 'expo';

declare class SecureVaultNativeModule extends NativeModule {
  readonly apiVersion: number;
}

export default requireNativeModule<SecureVaultNativeModule>('SecureVault');
