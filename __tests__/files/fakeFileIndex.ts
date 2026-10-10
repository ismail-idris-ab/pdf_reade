// In-memory stand-in for the native FileIndex module. Test files install it
// with:
//   jest.mock('../../modules/file-index/src/FileIndexModule', () =>
//     jest.requireActual('./fakeFileIndex').createFakeFileIndexModule());
//
// The file actions (apiVersion 4) run against a small in-memory filesystem:
// seed it with `addFile` / `addFolder`, inspect it with `exists`, and reset it
// with `resetFs` in `beforeEach`. Shared-storage write access (apiVersion 5)
// starts granted; `setSharedWriteAccess` / `setSharedWriteRequestOutcome`
// control it (`resetFs` resets them too). Every function is a jest.fn, so tests can
// still override single calls (e.g. `mockRejectedValueOnce`).
import type {
  CachedContent,
  DocumentCapabilities,
  FileIndexEvents,
  FileOpResult,
  FileStat,
  FolderEntry,
  FolderListing,
  FolderStats,
  ImportResult,
  PickDocumentsOptions,
  PickedDocument,
  ScanBatchEvent,
  ScanCompleteEvent,
  ScanErrorEvent,
  SharedWriteAccessResult,
} from '../../modules/file-index/src/FileIndexModule';

type Listeners = { [K in keyof FileIndexEvents]: Set<FileIndexEvents[K]> };

export type FakeFileIndexModule = ReturnType<typeof createFakeFileIndex>;

/** The fake's My Files root (an internal app files dir, as on a device). */
export const FAKE_MY_FILES_ROOT = '/data/user/0/com.ismailidris.pdfreader/files/MyFiles';

type Node = { isDirectory: boolean; size: number; mtime: number };

/** A content:// document the fake's importDocuments / renameDocument know about. */
export type FakeDocument = { name: string; size: number; mtime?: number };

const nativeError = (code: string, message = code) => Object.assign(new Error(message), { code });

const parentOf = (path: string) => path.slice(0, path.lastIndexOf('/'));
const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

function splitName(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? { stem: name.slice(0, dot), ext: name.slice(dot) } : { stem: name, ext: '' };
}

function utf8Length(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

function createFakeFileIndex() {
  const listeners: Listeners = {
    onScanBatch: new Set(),
    onScanComplete: new Set(),
    onScanError: new Set(),
  };
  const nodes = new Map<string, Node>();
  const documents = new Map<string, FakeDocument>();
  const refusingRename = new Set<string>();
  let sharedWriteGranted = true;
  let sharedWriteOutcome: SharedWriteAccessResult = 'granted';
  let clock = 1_700_000_000_000;
  const now = () => (clock += 1000);

  function addListener<K extends keyof FileIndexEvents>(name: K, listener: FileIndexEvents[K]) {
    (listeners[name] as Set<FileIndexEvents[K]>).add(listener);
    return {
      remove: () => {
        (listeners[name] as Set<FileIndexEvents[K]>).delete(listener);
      },
    };
  }

  function resetFs() {
    nodes.clear();
    documents.clear();
    refusingRename.clear();
    sharedWriteGranted = true;
    sharedWriteOutcome = 'granted';
    nodes.set(FAKE_MY_FILES_ROOT, { isDirectory: true, size: 0, mtime: 0 });
  }
  resetFs();

  // Like native: trims, then refuses empty, a leading "." (incl. "." / ".."), \ / : * ? " < > |,
  // control characters and names over 255 UTF-8 bytes. Returns the trimmed name.
  function checkName(raw: string): string {
    const name = raw.trim();
    if (
      name === '' ||
      name.startsWith('.') ||
      /[\\/:*?"<>|\u0000-\u001f\u007f]/.test(name) ||
      utf8Length(name) > 255
    ) {
      throw nativeError('ERR_NAME_INVALID');
    }
    return name;
  }

  function requireNode(path: string, isDirectory: boolean): Node {
    const node = nodes.get(path);
    if (!node || node.isDirectory !== isDirectory) throw nativeError('NOT_FOUND');
    return node;
  }

  function uniqueIn(dir: string, name: string, copySuffix: boolean): string {
    if (!nodes.has(`${dir}/${name}`)) return name;
    const { stem, ext } = splitName(name);
    for (let n = 1; ; n += 1) {
      const candidate = copySuffix
        ? `${stem} (copy${n === 1 ? '' : ` ${n}`})${ext}`
        : `${stem} (${n})${ext}`;
      if (!nodes.has(`${dir}/${candidate}`)) return candidate;
    }
  }

  // Moves a node and, for a folder, everything under it.
  function relocate(from: string, to: string) {
    for (const [path, node] of [...nodes]) {
      if (path === from || path.startsWith(`${from}/`)) {
        nodes.delete(path);
        nodes.set(to + path.slice(from.length), node);
      }
    }
  }

  const result = (path: string): FileOpResult => {
    const node = requireNode(path, false);
    return { path, name: baseName(path), size: node.size, mtime: node.mtime };
  };

  const entry = (path: string): FolderEntry => {
    const node = nodes.get(path) ?? { isDirectory: true, size: 0, mtime: 0 };
    return {
      path,
      name: baseName(path),
      isDirectory: node.isDirectory,
      size: node.size,
      mtime: node.mtime,
    };
  };

  return {
    apiVersion: 5,
    addListener: jest.fn(addListener),
    hasAllFilesAccess: jest.fn<boolean, []>(() => true),
    openAllFilesAccessSettings: jest.fn<Promise<void>, []>(() => Promise.resolve()),
    startScan: jest.fn<Promise<string>, [{ exts: string[]; knownMtimes: Record<string, number> }]>(
      () => Promise.resolve('scan-1'),
    ),
    cancelScan: jest.fn<void, [string]>(),
    // Answers from the in-memory filesystem (anything not added there is missing).
    stat: jest.fn<Promise<FileStat>, [string]>(async (path) => {
      const node = nodes.get(path);
      return node
        ? { exists: true, isFile: !node.isDirectory, size: node.size, mtime: node.mtime }
        : { exists: false, isFile: false, size: 0, mtime: 0 };
    }),
    copyContentUriToCache: jest.fn<Promise<CachedContent>, [string]>(),
    share: jest.fn<Promise<void>, [string[], string]>(() => Promise.resolve()),
    pickDocuments: jest.fn<Promise<PickedDocument[]>, [PickDocumentsOptions]>(() =>
      Promise.resolve([]),
    ),
    listPersistedUris: jest.fn<string[], []>(() => []),
    releasePersistedUri: jest.fn<void, [string]>(),

    hasSharedWriteAccess: jest.fn<boolean, []>(() => sharedWriteGranted),
    // Answers with the outcome set by setSharedWriteRequestOutcome; 'granted'
    // also grants access from then on, as the system permission would.
    requestSharedWriteAccess: jest.fn<Promise<SharedWriteAccessResult>, []>(async () => {
      if (sharedWriteOutcome === 'granted') sharedWriteGranted = true;
      return sharedWriteOutcome;
    }),

    getMyFilesRoot: jest.fn<string, []>(() => FAKE_MY_FILES_ROOT),
    renameFile: jest.fn<Promise<FileOpResult>, [string, string]>(async (path, newName) => {
      requireNode(path, false);
      const target = `${parentOf(path)}/${checkName(newName)}`;
      if (target !== path && nodes.has(target)) throw nativeError('ERR_NAME_EXISTS');
      relocate(path, target);
      return result(target);
    }),
    moveFile: jest.fn<Promise<FileOpResult>, [string, string]>(async (path, destDir) => {
      requireNode(path, false);
      requireNode(destDir, true);
      // Same folder: a no-op returning the current info, as natively.
      if (parentOf(path) === destDir) return result(path);
      const target = `${destDir}/${uniqueIn(destDir, baseName(path), false)}`;
      relocate(path, target);
      return result(target);
    }),
    copyFile: jest.fn<Promise<FileOpResult>, [string, string]>(async (path, destDir) => {
      const node = requireNode(path, false);
      requireNode(destDir, true);
      const sameDir = parentOf(path) === destDir;
      const target = `${destDir}/${uniqueIn(destDir, baseName(path), sameDir)}`;
      nodes.set(target, { ...node, mtime: now() });
      return result(target);
    }),
    deleteFile: jest.fn<Promise<void>, [string]>(async (path) => {
      requireNode(path, false);
      nodes.delete(path);
    }),
    listFolder: jest.fn<Promise<FolderListing>, [string]>(async (path) => {
      requireNode(path, true);
      const entries = [...nodes.keys()]
        .filter((child) => parentOf(child) === path && child !== path)
        .map(entry);
      return { path, entries };
    }),
    folderStats: jest.fn<Promise<FolderStats>, [string]>(async (path) => {
      requireNode(path, true);
      const stats: FolderStats = { fileCount: 0, folderCount: 0, totalBytes: 0 };
      for (const [child, node] of nodes) {
        if (!child.startsWith(`${path}/`)) continue;
        if (node.isDirectory) stats.folderCount += 1;
        else {
          stats.fileCount += 1;
          stats.totalBytes += node.size;
        }
      }
      return stats;
    }),
    createFolder: jest.fn<Promise<FolderEntry>, [string, string]>(async (parent, name) => {
      requireNode(parent, true);
      const path = `${parent}/${checkName(name)}`;
      if (nodes.has(path)) throw nativeError('ERR_NAME_EXISTS');
      nodes.set(path, { isDirectory: true, size: 0, mtime: now() });
      return entry(path);
    }),
    renameFolder: jest.fn<Promise<FolderEntry>, [string, string]>(async (path, newName) => {
      requireNode(path, true);
      const target = `${parentOf(path)}/${checkName(newName)}`;
      if (target !== path && nodes.has(target)) throw nativeError('ERR_NAME_EXISTS');
      relocate(path, target);
      return entry(target);
    }),
    deleteFolder: jest.fn<Promise<void>, [string]>(async (path) => {
      if (path === FAKE_MY_FILES_ROOT) throw nativeError('PERMISSION_DENIED');
      requireNode(path, true);
      for (const child of [...nodes.keys()]) {
        if (child === path || child.startsWith(`${path}/`)) nodes.delete(child);
      }
    }),
    importDocuments: jest.fn<Promise<ImportResult[]>, [string[], string]>(async (uris, destDir) => {
      requireNode(destDir, true);
      return uris.map((uri) => {
        const document = documents.get(uri);
        if (!document) return { uri, errorCode: 'NOT_FOUND' };
        const path = `${destDir}/${uniqueIn(destDir, document.name, false)}`;
        nodes.set(path, { isDirectory: false, size: document.size, mtime: now() });
        return { uri, file: result(path) };
      });
    }),
    documentCapabilities: jest.fn<Promise<DocumentCapabilities>, [string]>(async () => ({
      canRename: true,
      canDelete: true,
    })),
    // Renames and answers with a new live URI. `refuseRename(uri)` makes the
    // provider keep the old name instead (renamed: false), as when it could
    // not keep access under the new one.
    renameDocument: jest.fn<
      Promise<{ uri: string; name: string; renamed: boolean }>,
      [string, string]
    >(async (uri, newName) => {
      const name = checkName(newName);
      const document = documents.get(uri);
      if (!document) throw nativeError('ERR_FILE_OP_FAILED');
      documents.delete(uri);
      const live = `${uri}-renamed`;
      if (refusingRename.has(uri)) {
        documents.set(live, document);
        return { uri: live, name: document.name, renamed: false };
      }
      documents.set(live, { ...document, name });
      return { uri: live, name, renamed: true };
    }),
    deleteDocument: jest.fn<Promise<void>, [string]>(async (uri) => {
      if (!documents.delete(uri)) throw nativeError('NOT_FOUND');
    }),
    printPdf: jest.fn<Promise<void>, [string, string]>(() => Promise.resolve()),

    // ── Test helpers ──────────────────────────────────────────────────────
    resetFs,
    /** Adds a file (creating missing parent folders) and returns its metadata. */
    addFile(path: string, size = 100, mtime = now()): FileOpResult {
      let dir = parentOf(path);
      while (dir.length > FAKE_MY_FILES_ROOT.length && !nodes.has(dir)) {
        nodes.set(dir, { isDirectory: true, size: 0, mtime: 0 });
        dir = parentOf(dir);
      }
      nodes.set(path, { isDirectory: false, size, mtime });
      return { path, name: baseName(path), size, mtime };
    },
    addFolder(path: string) {
      nodes.set(path, { isDirectory: true, size: 0, mtime: now() });
    },
    /** Registers a content:// document for importDocuments / renameDocument. */
    addDocument(uri: string, document: FakeDocument) {
      documents.set(uri, document);
    },
    exists(path: string): boolean {
      return nodes.has(path);
    },
    hasDocument(uri: string): boolean {
      return documents.has(uri);
    },
    /** Sets what hasSharedWriteAccess answers. */
    setSharedWriteAccess(granted: boolean) {
      sharedWriteGranted = granted;
    },
    /** Sets what later requestSharedWriteAccess calls resolve with. */
    setSharedWriteRequestOutcome(outcome: SharedWriteAccessResult) {
      sharedWriteOutcome = outcome;
    },
    /** Makes renameDocument keep this document's old name (renamed: false). */
    refuseRename(uri: string) {
      refusingRename.add(uri);
    },

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
