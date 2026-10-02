import { NativeModule, requireNativeModule } from 'expo';

declare class FileIndexNativeModule extends NativeModule {
  readonly apiVersion: number;
}

export default requireNativeModule<FileIndexNativeModule>('FileIndex');
