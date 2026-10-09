import FileIndexModule from '../../modules/file-index/src/FileIndexModule';
import type { FakeFileIndexModule } from './fakeFileIndex';
import { AppError } from '@/lib/errors';
import {
  DEFAULT_PICK_MIME_TYPES,
  extForMime,
  listPersistedUris,
  pickDocuments,
  releasePersistedUri,
} from '@/lib/files';

jest.mock('../../modules/file-index/src/FileIndexModule', () =>
  jest.requireActual('./fakeFileIndex').createFakeFileIndexModule(),
);

const native = FileIndexModule as unknown as FakeFileIndexModule;

const coded = (code: string) => Object.assign(new Error(code), { code });

beforeEach(() => jest.clearAllMocks());

describe('DEFAULT_PICK_MIME_TYPES', () => {
  it('covers pdf, doc, docx, xls, xlsx, csv, txt, ppt and pptx', () => {
    expect(DEFAULT_PICK_MIME_TYPES).toEqual([
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'text/plain',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ]);
  });
});

describe('extForMime', () => {
  it('maps known types, ignoring case and parameters', () => {
    expect(extForMime('application/pdf')).toBe('pdf');
    expect(extForMime('Text/Plain; charset=utf-8')).toBe('txt');
    expect(extForMime('text/comma-separated-values')).toBe('csv');
    expect(extForMime('image/png')).toBeNull();
  });
});

describe('pickDocuments', () => {
  it('defaults to the document MIME types and multiple selection', async () => {
    const doc = {
      uri: 'content://p/1',
      name: 'a.pdf',
      size: 1,
      mime: null,
      mtime: null,
      persisted: true,
    };
    native.pickDocuments.mockResolvedValueOnce([doc]);
    await expect(pickDocuments()).resolves.toEqual([doc]);
    expect(native.pickDocuments).toHaveBeenCalledWith({
      mimeTypes: [...DEFAULT_PICK_MIME_TYPES],
      multiple: true,
    });
  });

  it('passes explicit options and resolves [] on cancel', async () => {
    await expect(
      pickDocuments({ mimeTypes: ['application/pdf'], multiple: false }),
    ).resolves.toEqual([]);
    expect(native.pickDocuments).toHaveBeenCalledWith({
      mimeTypes: ['application/pdf'],
      multiple: false,
    });
  });

  it('passes persist only when set (native default: true)', async () => {
    await pickDocuments({ persist: false });
    expect(native.pickDocuments).toHaveBeenLastCalledWith({
      mimeTypes: [...DEFAULT_PICK_MIME_TYPES],
      multiple: true,
      persist: false,
    });
    await pickDocuments({ persist: true });
    expect(native.pickDocuments).toHaveBeenLastCalledWith(
      expect.objectContaining({ persist: true }),
    );
  });

  it.each(['ERR_NO_ACTIVITY', 'ERR_PICK_IN_PROGRESS', 'ERR_NO_PICKER', 'ERR_MODULE_DESTROYED'])(
    'maps %s to an UNKNOWN AppError',
    async (code) => {
      native.pickDocuments.mockRejectedValueOnce(coded(code));
      const result = pickDocuments();
      await expect(result).rejects.toBeInstanceOf(AppError);
      await expect(result).rejects.toMatchObject({ code: 'UNKNOWN' });
    },
  );

  it('keeps shared error codes', async () => {
    native.pickDocuments.mockRejectedValueOnce(coded('PERMISSION_DENIED'));
    await expect(pickDocuments()).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});

describe('persisted URIs', () => {
  it('lists and releases through the native module', () => {
    native.listPersistedUris.mockReturnValueOnce(['content://p/1']);
    expect(listPersistedUris()).toEqual(['content://p/1']);
    releasePersistedUri('content://p/1');
    expect(native.releasePersistedUri).toHaveBeenCalledWith('content://p/1');
  });

  it('normalises native failures to AppError', () => {
    native.listPersistedUris.mockImplementationOnce(() => {
      throw coded('ERR_MODULE_DESTROYED');
    });
    expect(() => listPersistedUris()).toThrow(AppError);
  });
});
