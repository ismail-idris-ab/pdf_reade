import { MAX_STRING_LENGTH, REDACTED, scrubText, scrubValue } from '@/lib/crash/scrub';

describe('scrubText', () => {
  it.each([
    'Failed to open /storage/emulated/0/Download/bank statement.pdf',
    '/storage/emulated/0/Download/Ismail CV (2).pdf failed',
    'bank statement (1).pdf',
    'Ismail Idris CV.pdf',
    'file:///storage/emulated/0/My Docs/cv.pdf',
    'content://com.android.providers.downloads.documents/document/42 denied',
    'SecurityException: Permission Denial: reading uri content://media/external/file/9',
    '/data/user/0/com.ismailidris.pdfreader/files/SQLite/pdfreader.db locked',
    'read /storage/emulated/0/My Docs/Ismail ID/scan',
    'primary:Documents/NIN slip',
    'Download/Ismail Idris passport',
    'Could not render JAMB_result_slip.PDF page 2',
    'saved (passport photo.jpeg)',
    'WhatsApp Image 2024-05-01 at 10.30.22.jpg',
  ])('redacts the whole string: %p', (input) => {
    expect(scrubText(input)).toBe(REDACTED);
  });

  it('keeps messages without file references intact', () => {
    for (const message of [
      'TypeError: undefined is not a function (index.android.bundle:12:34)',
      'PDFIUM_ERROR:3',
      'NO_SPACE',
      'Network request failed',
    ]) {
      expect(scrubText(message)).toBe(message);
    }
  });

  it('truncates long strings', () => {
    expect(scrubText('a'.repeat(5000))).toHaveLength(MAX_STRING_LENGTH);
  });

  it('runs in linear time on long inputs without spaces (no ReDoS)', () => {
    const inputs = ['a'.repeat(100_000), `${'x'.repeat(100_000)}.pd`, '/'.repeat(100_000)];
    const start = Date.now();
    for (const input of inputs) scrubText(input);
    expect(Date.now() - start).toBeLessThan(200);
  });
});

describe('scrubValue', () => {
  it('scrubs nested event data without mutating the input', () => {
    const event = {
      message: 'open /storage/emulated/0/Documents/cv.docx',
      exception: { values: [{ type: 'Error', value: 'NOT_FOUND: Résumé.pdf' }] },
      breadcrumbs: [{ category: 'ui', message: 'opened WhatsApp Image 2024.jpg' }],
      extra: { 'invoice.pdf': 1, count: 2 },
    };
    const original = JSON.parse(JSON.stringify(event));

    expect(scrubValue(event)).toEqual({
      message: REDACTED,
      exception: { values: [{ type: 'Error', value: REDACTED }] },
      breadcrumbs: [{ category: 'ui', message: REDACTED }],
      extra: { [REDACTED]: 1, count: 2 },
    });
    expect(event).toEqual(original);
  });

  it('never passes data below the depth limit through unscrubbed', () => {
    let deep: unknown = 'cv.pdf';
    for (let i = 0; i < 12; i++) deep = { child: deep };
    expect(JSON.stringify(scrubValue(deep))).not.toContain('cv.pdf');
  });

  it('passes through non-string primitives', () => {
    expect(scrubValue({ n: 1, ok: true, nothing: null })).toEqual({
      n: 1,
      ok: true,
      nothing: null,
    });
  });
});
