import FileIndexModule from '../../../modules/file-index/src/FileIndexModule';

/** Contract version reported by the native `file-index` module. */
export function getFileIndexApiVersion(): number {
  return FileIndexModule.apiVersion;
}
