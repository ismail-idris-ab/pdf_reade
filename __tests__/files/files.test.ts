import fs from 'node:fs';
import path from 'node:path';

import FileIndexModule from '../../modules/file-index/src/FileIndexModule';
import type { FakeFileIndexModule } from './fakeFileIndex';
import { AppError } from '@/lib/errors';
import {
  APP_PACKAGE,
  DEFAULT_SCAN_EXTS,
  classifySource,
  copyContentUriToCache,
  copyFile,
  createFolder,
  deleteDocument,
  deleteFile,
  deleteFolder,
  documentCapabilities,
  fileOpErrorKind,
  folderStats,
  getFileIndexApiVersion,
  getMyFilesRoot,
  isNameErrorKind,
  isTempEntry,
  keepExtension,
  splitExtension,
  hasAllFilesAccess,
  importDocuments,
  isInMyFiles,
  listFolder,
  moveFile,
  nativeErrorCode,
  openAllFilesAccessSettings,
  printPdf,
  renameDocument,
  renameFile,
  renameFolder,
  share,
  stat,
  toNewFile,
  tryGetMyFilesRoot,
  validateFileName,
} from '@/lib/files';

jest.mock('../../modules/file-index/src/FileIndexModule', () =>
  jest.requireActual('./fakeFileIndex').createFakeFileIndexModule(),
);

const native = FileIndexModule as unknown as FakeFileIndexModule;

const nativeError = (code: string) => Object.assign(new Error('native failure'), { code });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('classifySource', () => {
  it.each([
    ['/storage/emulated/0/Download/report.pdf', 'downloads'],
    ['/storage/emulated/0/Download/Telegram/notes.docx', 'downloads'],
    ['/storage/emulated/10/Download/report.pdf', 'downloads'],
    ['/storage/1A2B-3C4D/Download/report.pdf', 'downloads'],
    ['/storage/emulated/0/download/report.pdf', 'downloads'],
    ['/storage/emulated/0/DOWNLOAD/report.pdf', 'downloads'],
    ['/sdcard/Download/report.pdf', 'downloads'],
    ['file:///storage/emulated/0/Download/report.pdf', 'downloads'],
  ])('%s -> %s', (input, expected) => {
    expect(classifySource(input)).toBe(expected);
  });

  it.each([
    '/storage/emulated/0/Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Documents/a.pdf',
    '/storage/emulated/0/Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Documents/Sent/a.pdf',
    '/storage/emulated/0/WhatsApp/Media/WhatsApp Documents/a.pdf',
    '/storage/emulated/0/Android/media/com.whatsapp.w4b/WhatsApp Business/Media/WhatsApp Business Documents/a.pdf',
    '/storage/emulated/0/WhatsApp Business/Media/WhatsApp Business Documents/a.pdf',
    '/storage/1A2B-3C4D/WhatsApp/Media/WhatsApp Documents/a.pdf',
    '/storage/emulated/0/android/media/com.whatsapp/whatsapp/media/whatsapp documents/a.pdf',
  ])('%s -> whatsapp', (input) => {
    expect(classifySource(input)).toBe('whatsapp');
  });

  it.each([
    `/data/user/0/${APP_PACKAGE}/files/Scans/scan-1.pdf`,
    `/data/data/${APP_PACKAGE}/files/Scans/scan-1.pdf`,
    `/storage/emulated/0/Android/data/${APP_PACKAGE}/files/Scans/scan-1.pdf`,
  ])('%s -> scans', (input) => {
    expect(classifySource(input)).toBe('scans');
  });

  it.each([
    `/data/user/0/${APP_PACKAGE}/files/MyFiles/notes.pdf`,
    `/data/data/${APP_PACKAGE}/files/MyFiles/Sub/notes.pdf`,
    `/storage/emulated/0/Android/data/${APP_PACKAGE}/files/MyFiles/notes.pdf`,
    `file:///data/user/0/${APP_PACKAGE}/files/myfiles/notes.pdf`,
  ])('%s -> myfiles', (input) => {
    expect(classifySource(input)).toBe('myfiles');
  });

  it.each([
    '/storage/emulated/0/Download2/report.pdf',
    '/storage/emulated/0/MyDownload/report.pdf',
    '/storage/emulated/0/Downloads/report.pdf',
    '/storage/emulated/0/Documents/Download/report.pdf',
    '/storage/emulated/0/Download',
    '/storage/emulated/0/WhatsApp/Media/WhatsApp Images/a.pdf',
    '/storage/emulated/0/Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Documents2/a.pdf',
    '/storage/emulated/0/Backup/WhatsApp/Media/WhatsApp Documents/a.pdf',
    `/data/user/0/${APP_PACKAGE}/files/Scans2/scan.pdf`,
    `/data/user/0/${APP_PACKAGE}/cache/Scans/scan.pdf`,
    '/data/user/0/com.other.app/files/Scans/scan.pdf',
    `/data/user/0/${APP_PACKAGE}/files/MyFiles2/notes.pdf`,
    '/data/user/0/com.other.app/files/MyFiles/notes.pdf',
    '/storage/emulated/0/MyFiles/notes.pdf',
    '/storage/emulated/0/Scans/scan.pdf',
    '/storage/emulated/0/Documents/cv.pdf',
  ])('%s -> device', (input) => {
    expect(classifySource(input)).toBe('device');
  });

  it('keeps APP_PACKAGE in sync with app.config.ts', () => {
    const config = fs.readFileSync(path.join(__dirname, '../../app.config.ts'), 'utf8');
    expect(config).toContain(`const ANDROID_PACKAGE = '${APP_PACKAGE}';`);
  });
});

describe('toNewFile', () => {
  const scanned = {
    path: '/storage/emulated/0/WhatsApp/Media/WhatsApp Documents/Invoice.PDF',
    name: 'Invoice.PDF',
    ext: 'PDF',
    size: 2048,
    mtime: 1_700_000_000_000,
  };

  it('maps a scanned file to a NewFile with the classified source', () => {
    expect(toNewFile(scanned)).toEqual({
      path: scanned.path,
      uri: null,
      name: 'Invoice.PDF',
      ext: 'pdf',
      mime: 'application/pdf',
      size: 2048,
      mtime: 1_700_000_000_000,
      source: 'whatsapp',
    });
  });

  it('uses an explicit source when given', () => {
    expect(toNewFile(scanned, 'device').source).toBe('device');
  });

  it.each([
    ['pdf', 'application/pdf'],
    ['doc', 'application/msword'],
    ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['xls', 'application/vnd.ms-excel'],
    ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['csv', 'text/csv'],
    ['txt', 'text/plain'],
    ['ppt', 'application/vnd.ms-powerpoint'],
    ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ])('maps %s to %s', (ext, mime) => {
    expect(toNewFile({ ...scanned, ext }).mime).toBe(mime);
  });

  it('has a MIME type for every default scan extension and null for others', () => {
    for (const ext of DEFAULT_SCAN_EXTS) {
      expect(toNewFile({ ...scanned, ext }).mime).not.toBeNull();
    }
    expect(toNewFile({ ...scanned, ext: 'epub' }).mime).toBeNull();
  });
});

describe('native wrappers', () => {
  it('reads the api version and all-files access', () => {
    expect(getFileIndexApiVersion()).toBe(4);
    native.hasAllFilesAccess.mockReturnValueOnce(false);
    expect(hasAllFilesAccess()).toBe(false);
  });

  it('normalises a synchronous hasAllFilesAccess failure', () => {
    native.hasAllFilesAccess.mockImplementationOnce(() => {
      throw nativeError('PERMISSION_DENIED');
    });
    expect(() => hasAllFilesAccess()).toThrow(AppError);
  });

  it('passes results through', async () => {
    native.stat.mockResolvedValueOnce({ exists: true, isFile: true, size: 1, mtime: 2 });
    await expect(stat('/a.pdf')).resolves.toEqual({
      exists: true,
      isFile: true,
      size: 1,
      mtime: 2,
    });
    expect(native.stat).toHaveBeenCalledWith('/a.pdf');

    const cached = {
      path: '/cache/a.pdf',
      name: 'a.pdf',
      nameFromProvider: true,
      size: 1,
      mime: null,
    };
    native.copyContentUriToCache.mockResolvedValueOnce(cached);
    await expect(copyContentUriToCache('content://x/1')).resolves.toEqual(cached);

    native.share.mockResolvedValueOnce(undefined);
    await share(['/a.pdf', '/b.pdf'], 'application/pdf');
    expect(native.share).toHaveBeenCalledWith(['/a.pdf', '/b.pdf'], 'application/pdf');

    await openAllFilesAccessSettings();
    expect(native.openAllFilesAccessSettings).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['stat', () => stat('/a.pdf'), 'NOT_FOUND'],
    ['copyContentUriToCache', () => copyContentUriToCache('content://x/1'), 'NO_SPACE'],
    ['share', () => share(['/a.pdf'], 'application/pdf'), 'NOT_FOUND'],
    ['openAllFilesAccessSettings', () => openAllFilesAccessSettings(), 'UNSUPPORTED'],
  ] as const)('%s rejects with an AppError carrying the native code', async (name, call, code) => {
    native[name].mockRejectedValueOnce(nativeError(code));
    const error = await call().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
  });

  it('maps unknown native failures to UNKNOWN', async () => {
    native.stat.mockRejectedValueOnce(new Error('weird'));
    await expect(stat('/a.pdf')).rejects.toMatchObject({ name: 'AppError', code: 'UNKNOWN' });
  });
});

describe('file action wrappers (apiVersion 4)', () => {
  const ROOT = '/data/user/0/com.ismailidris.pdfreader/files/MyFiles';

  beforeEach(() => native.resetFs());

  it('passes calls through and returns native results', async () => {
    native.addFile(`${ROOT}/a.pdf`, 10, 5);
    expect(getMyFilesRoot()).toBe(ROOT);
    await expect(renameFile(`${ROOT}/a.pdf`, 'b.pdf')).resolves.toEqual({
      path: `${ROOT}/b.pdf`,
      name: 'b.pdf',
      size: 10,
      mtime: 5,
    });
    await createFolder(ROOT, 'Sub');
    await expect(moveFile(`${ROOT}/b.pdf`, `${ROOT}/Sub`)).resolves.toMatchObject({
      path: `${ROOT}/Sub/b.pdf`,
    });
    await expect(copyFile(`${ROOT}/Sub/b.pdf`, `${ROOT}/Sub`)).resolves.toMatchObject({
      name: 'b (copy).pdf',
    });
    await expect(listFolder(`${ROOT}/Sub`)).resolves.toMatchObject({
      entries: expect.arrayContaining([expect.objectContaining({ name: 'b.pdf' })]),
    });
    await expect(folderStats(`${ROOT}/Sub`)).resolves.toEqual({
      fileCount: 2,
      folderCount: 0,
      totalBytes: 20,
    });
    await expect(renameFolder(`${ROOT}/Sub`, 'Docs')).resolves.toMatchObject({
      path: `${ROOT}/Docs`,
      isDirectory: true,
    });
    await deleteFile(`${ROOT}/Docs/b.pdf`);
    await deleteFolder(`${ROOT}/Docs`);
    expect(native.exists(`${ROOT}/Docs`)).toBe(false);

    native.addDocument('content://p/1', { name: 'x.pdf', size: 3 });
    await expect(importDocuments(['content://p/1', 'content://p/2'], ROOT)).resolves.toEqual([
      { uri: 'content://p/1', file: expect.objectContaining({ path: `${ROOT}/x.pdf` }) },
      { uri: 'content://p/2', errorCode: 'NOT_FOUND' },
    ]);
    await expect(renameDocument('content://p/1', 'y.pdf')).resolves.toEqual({
      uri: 'content://p/1-renamed',
      name: 'y.pdf',
      renamed: true,
    });
    await deleteDocument('content://p/1-renamed');
    await printPdf('/a.pdf', 'a.pdf');
    expect(native.printPdf).toHaveBeenCalledWith('/a.pdf', 'a.pdf');
  });

  it('keeps the non-shared name errors distinguishable', async () => {
    native.addFile(`${ROOT}/a.pdf`);
    native.addFile(`${ROOT}/b.pdf`);
    const exists = await renameFile(`${ROOT}/a.pdf`, 'b.pdf').catch((e: unknown) => e);
    expect(exists).toBeInstanceOf(AppError);
    expect((exists as AppError).code).toBe('UNKNOWN');
    expect(nativeErrorCode(exists)).toBe('ERR_NAME_EXISTS');
    expect(fileOpErrorKind(exists)).toBe('nameExists');

    const invalid = await createFolder(ROOT, '..').catch((e: unknown) => e);
    expect(fileOpErrorKind(invalid)).toBe('nameInvalid');

    native.deleteFile.mockRejectedValueOnce(nativeError('NOT_FOUND'));
    const gone = await deleteFile(`${ROOT}/zzz.pdf`).catch((e: unknown) => e);
    expect((gone as AppError).code).toBe('NOT_FOUND');
    expect(fileOpErrorKind(gone)).toBeNull();
    expect(nativeErrorCode(gone)).toBe('NOT_FOUND');

    native.moveFile.mockRejectedValueOnce(nativeError('ERR_FILE_OP_FAILED'));
    const failed = await moveFile('/x', ROOT).catch((e: unknown) => e);
    expect((failed as AppError).code).toBe('UNKNOWN');
    expect(nativeErrorCode(failed)).toBe('ERR_FILE_OP_FAILED');
    expect(fileOpErrorKind(failed)).toBeNull();
  });

  it('documentCapabilities never rejects', async () => {
    await expect(documentCapabilities('content://p/1')).resolves.toEqual({
      canRename: true,
      canDelete: true,
    });
    native.documentCapabilities.mockRejectedValueOnce(new Error('boom'));
    await expect(documentCapabilities('content://p/1')).resolves.toEqual({
      canRename: false,
      canDelete: false,
    });
  });

  it('getMyFilesRoot throws an AppError; tryGetMyFilesRoot returns null', () => {
    native.getMyFilesRoot.mockImplementationOnce(() => {
      throw nativeError('PERMISSION_DENIED');
    });
    expect(() => getMyFilesRoot()).toThrow(AppError);
    native.getMyFilesRoot.mockImplementationOnce(() => {
      throw new Error('no module');
    });
    expect(tryGetMyFilesRoot()).toBeNull();
  });

  it('isInMyFiles matches the native root and the classifier locations', () => {
    expect(isInMyFiles(`${ROOT}/a/b.pdf`, ROOT)).toBe(true);
    expect(isInMyFiles(ROOT, ROOT)).toBe(true);
    expect(isInMyFiles('/custom/root/x.pdf', '/custom/root')).toBe(true);
    expect(isInMyFiles(`${ROOT}2/x.pdf`, '/custom/root')).toBe(false);
    expect(isInMyFiles(`${ROOT}/x.pdf`, null)).toBe(true);
    expect(isInMyFiles('/storage/emulated/0/Download/x.pdf', ROOT)).toBe(false);
  });

  it.each([
    ['', 'empty'],
    ['a/b', 'invalidChars'],
    ['a\0b', 'invalidChars'],
    ['a\\b', 'invalidChars'],
    ['a:b', 'invalidChars'],
    ['a*b', 'invalidChars'],
    ['a?b', 'invalidChars'],
    ['a"b', 'invalidChars'],
    ['a<b', 'invalidChars'],
    ['a>b', 'invalidChars'],
    ['a|b', 'invalidChars'],
    ['a\u0001b', 'invalidChars'],
    ['a\nb', 'invalidChars'],
    ['a\u007fb', 'invalidChars'],
    ['Résumé (final) #2.pdf', null],
    ['.', 'leadingDot'],
    ['..', 'leadingDot'],
    ['report.pdf', null],
    ['.hidden', 'leadingDot'],
    ['report.v2.pdf', null],
    ['a.', null],
  ])('validateFileName(%j) -> %s', (name, problem) => {
    expect(validateFileName(name)).toBe(problem);
  });

  it('limits names to 255 UTF-8 bytes, not characters', () => {
    expect(validateFileName('a'.repeat(255))).toBeNull();
    expect(validateFileName('a'.repeat(256))).toBe('tooLong');
    // "é" is 2 bytes in UTF-8.
    expect(validateFileName('é'.repeat(127))).toBeNull();
    expect(validateFileName('é'.repeat(128))).toBe('tooLong');
  });
});

describe('name helpers', () => {
  it('fileOpErrorKind recognises the codes with their own message', () => {
    const error = (code: string) => new AppError('UNKNOWN', 'x', { cause: { code } });
    // No longer a native code: renameDocument answers renamed: false instead.
    expect(fileOpErrorKind(error('ERR_RENAME_UNSUPPORTED'))).toBeNull();
    expect(fileOpErrorKind(error('ERR_DUPLICATE_LEFT'))).toBe('duplicateLeft');
    expect(fileOpErrorKind(error('ERR_FILE_OP_FAILED'))).toBeNull();
    expect(isNameErrorKind('nameExists')).toBe(true);
    expect(isNameErrorKind('duplicateLeft')).toBe(false);
    expect(isNameErrorKind(null)).toBe(false);
  });

  it('isTempEntry matches only native work files', () => {
    // Names exactly as NameRules.kt writes them.
    expect(isTempEntry('.report.pdf.tmp-1791412064000-1a2b')).toBe(true);
    expect(isTempEntry('.rename-1791412064000-9f3c')).toBe(true);
    expect(isTempEntry('.rename-1791412064000-9f3c.orig')).toBe(true);
    expect(isTempEntry('.report.pdf')).toBe(false);
    expect(isTempEntry('.hidden')).toBe(false);
    expect(isTempEntry('report.tmp-1.pdf')).toBe(false);
    expect(isTempEntry('notes.pdf')).toBe(false);
  });

  it('splitExtension follows the native rule', () => {
    expect(splitExtension('a.b.pdf')).toEqual({ base: 'a.b', ext: '.pdf' });
    expect(splitExtension('.hidden')).toEqual({ base: '.hidden', ext: '' });
    expect(splitExtension('trailing.')).toEqual({ base: 'trailing.', ext: '' });
    expect(splitExtension('plain')).toEqual({ base: 'plain', ext: '' });
  });

  it('keepExtension keeps a file’s extension', () => {
    expect(keepExtension('Report', 'old.pdf')).toBe('Report.pdf');
    expect(keepExtension('Report.pdf', 'old.pdf')).toBe('Report.pdf');
    expect(keepExtension('Report.PDF', 'old.pdf')).toBe('Report.PDF');
    expect(keepExtension('Report.txt', 'old.pdf')).toBe('Report.txt.pdf');
    expect(keepExtension('Report.txt', 'no-extension')).toBe('Report.txt');
  });
});
