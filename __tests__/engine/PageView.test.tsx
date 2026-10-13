import { fireEvent, render, screen } from '@testing-library/react-native';
import { PixelRatio } from 'react-native';

import { PdfPageView as NativePdfPageView } from '../../modules/pdf-engine/src/PdfPageView';
import { nativeEvent } from './fakePdfPageView';
import { AppError } from '@/lib/errors';
import { PageView, pageRenderError, PdfPageView } from '@/lib/engine';

jest.mock('../../modules/pdf-engine/src/PdfEngineModule', () =>
  jest.requireActual('./fakePdfEngine').createFakePdfEngineModule(),
);
jest.mock('../../modules/pdf-engine/src/PdfPageView', () =>
  jest.requireActual('./fakePdfPageView').createFakePdfPageViewModule(),
);

const nativeView = jest.mocked(NativePdfPageView);

function lastNativeProps() {
  const call = nativeView.mock.calls.at(-1);
  if (!call) throw new Error('PdfPageView was not rendered');
  return call[0];
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('PdfPageView export', () => {
  it('re-exports the native view unchanged', () => {
    expect(PdfPageView).toBe(NativePdfPageView);
  });
});

describe('PageView', () => {
  it('passes docId, page and draw flags through and defaults renderScale to the density', async () => {
    await render(
      <PageView docId="doc-1" page={4} nightMode sepia={false} style={{ width: 300 }} />,
    );
    expect(lastNativeProps()).toMatchObject({
      docId: 'doc-1',
      page: 4,
      nightMode: true,
      sepia: false,
      renderScale: PixelRatio.get(),
      style: { width: 300 },
    });
  });

  it('passes retryToken through so a failed page can be rendered again', async () => {
    await render(<PageView docId="doc-1" page={2} retryToken={3} />);
    expect(lastNativeProps().retryToken).toBe(3);
  });

  it('keeps an explicit renderScale', async () => {
    await render(<PageView docId="doc-1" page={0} renderScale={5.25} />);
    expect(lastNativeProps().renderScale).toBe(5.25);
  });

  it('does not subscribe to native events nobody listens to', async () => {
    await render(<PageView docId="doc-1" page={0} />);
    expect(lastNativeProps().onRendered).toBeUndefined();
    expect(lastNativeProps().onRenderError).toBeUndefined();
  });

  it('unwraps onRendered to the native event payload', async () => {
    const onRendered = jest.fn();
    await render(<PageView docId="doc-1" page={2} onRendered={onRendered} />);
    const payload = { page: 2, widthPx: 1080, heightPx: 1398, ms: 37 };
    await fireEvent(screen.getByTestId('pdf-page-view-2'), 'rendered', nativeEvent(payload));
    expect(onRendered).toHaveBeenCalledWith(payload);
  });

  it.each(['CORRUPT_FILE', 'OUT_OF_MEMORY'] as const)(
    'maps a %s render error to an AppError with that code',
    async (code) => {
      const onRenderError = jest.fn();
      await render(<PageView docId="doc-1" page={1} onRenderError={onRenderError} />);
      await fireEvent(
        screen.getByTestId('pdf-page-view-1'),
        'renderError',
        nativeEvent({ page: 1, code }),
      );
      const [error, page] = onRenderError.mock.calls[0] as [AppError, number];
      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe(code);
      expect(page).toBe(1);
    },
  );

  it.each(['ERR_DOC_NOT_OPEN', 'ERR_INVALID_ARGUMENT', 'ERR_RENDER_FAILED'])(
    'maps the non-shared code %s to UNKNOWN and keeps it as the message',
    async (code) => {
      const onRenderError = jest.fn();
      await render(<PageView docId="doc-1" page={3} onRenderError={onRenderError} />);
      await fireEvent(
        screen.getByTestId('pdf-page-view-3'),
        'renderError',
        nativeEvent({ page: 3, code }),
      );
      const [error] = onRenderError.mock.calls[0] as [AppError, number];
      expect(error.code).toBe('UNKNOWN');
      expect(error.message).toBe(code);
    },
  );
});

describe('pageRenderError', () => {
  it('keeps shared codes and falls back to UNKNOWN', () => {
    expect(pageRenderError({ page: 0, code: 'CORRUPT_FILE' }).code).toBe('CORRUPT_FILE');
    expect(pageRenderError({ page: 0, code: 'whatever' }).code).toBe('UNKNOWN');
  });
});
