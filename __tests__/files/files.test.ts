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
  getFileIndexApiVersion,
  hasAllFilesAccess,
  openAllFilesAccessSettings,
  share,
  stat,
  toNewFile,
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
    expect(getFileIndexApiVersion()).toBe(2);
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
