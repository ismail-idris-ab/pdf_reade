// In-memory stand-in for the native FileIndex module. Test files install it
// with:
//   jest.mock('../../modules/file-index/src/FileIndexModule', () =>
//     jest.requireActual('./fakeFileIndex').createFakeFileIndexModule());
import type {
  CachedContent,
  FileIndexEvents,
  FileStat,
  PickDocumentsOptions,
  PickedDocument,
  ScanBatchEvent,
  ScanCompleteEvent,
  ScanErrorEvent,
} from '../../modules/file-index/src/FileIndexModule';

type Listeners = { [K in keyof FileIndexEvents]: Set<FileIndexEvents[K]> };

export type FakeFileIndexModule = ReturnType<typeof createFakeFileIndex>;

function createFakeFileIndex() {
  const listeners: Listeners = {
    onScanBatch: new Set(),
    onScanComplete: new Set(),
    onScanError: new Set(),
  };

  function addListener<K extends keyof FileIndexEvents>(name: K, listener: FileIndexEvents[K]) {
    (listeners[name] as Set<FileIndexEvents[K]>).add(listener);
    return {
      remove: () => {
        (listeners[name] as Set<FileIndexEvents[K]>).delete(listener);
      },
    };
  }

  return {
    apiVersion: 3,
    addListener: jest.fn(addListener),
    hasAllFilesAccess: jest.fn<boolean, []>(() => true),
    openAllFilesAccessSettings: jest.fn<Promise<void>, []>(() => Promise.resolve()),
    startScan: jest.fn<Promise<string>, [{ exts: string[]; knownMtimes: Record<string, number> }]>(
      () => Promise.resolve('scan-1'),
    ),
    cancelScan: jest.fn<void, [string]>(),
    stat: jest.fn<Promise<FileStat>, [string]>(),
    copyContentUriToCache: jest.fn<Promise<CachedContent>, [string]>(),
    share: jest.fn<Promise<void>, [string[], string]>(),
    pickDocuments: jest.fn<Promise<PickedDocument[]>, [PickDocumentsOptions]>(() =>
      Promise.resolve([]),
    ),
    listPersistedUris: jest.fn<string[], []>(() => []),
    releasePersistedUri: jest.fn<void, [string]>(),
    emitBatch(event: ScanBatchEvent) {
      for (const listener of [...listeners.onScanBatch]) listener(event);
    },
    emitComplete(event: ScanCompleteEvent) {
      for (const listener of [...listeners.onScanComplete]) listener(event);
    },
    emitError(event: ScanErrorEvent) {
      for (const listener of [...listeners.onScanError]) listener(event);
    },
    listenerCount(): number {
      return (
        listeners.onScanBatch.size + listeners.onScanComplete.size + listeners.onScanError.size
      );
    },
  };
}

export function createFakeFileIndexModule() {
  return { __esModule: true, default: createFakeFileIndex() };
}
