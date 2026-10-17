import { useToastStore } from '@/components/ui';
import type { PageText, SelectionRequest } from '@/features/reader/selection';
import { createSelectionController } from '@/features/reader/selectionController';
import { createReaderStore } from '@/features/reader/store';
import { createTextRectsCache } from '@/features/reader/textRectsCache';

jest.mock('../../modules/pdf-engine/src/PdfEngineModule', () =>
  jest.requireActual('../engine/fakePdfEngine').createFakePdfEngineModule(),
);

const W = 0.01;
const H = 0.02;
const VIEW = { width: 1000, height: 1000 };

/** Two lines: "Sannu da zuwa" at y 0.1, "ƙasa ɗaya" at y 0.2. */
function fixture(): PageText {
  const lines = ['Sannu da zuwa', 'ƙasa ɗaya'];
  let text = '';
  const boxes: number[] = [];
  lines.forEach((line, index) => {
    if (index > 0) {
      text += '\r\n';
      boxes.push(0, 0, 0, 0, 0, 0, 0, 0);
    }
    for (let i = 0; i < line.length; i += 1) boxes.push(0.1 + i * W, 0.1 * (index + 1), W, H);
    text += line;
  });
  return { text, boxes, rotation: 0 };
}

/** A long press over character `column` of line `line` (0-based). */
function pressAt(line: number, column: number, page = 0): SelectionRequest {
  return {
    page,
    point: { x: (0.1 + column * W + W / 2) * 1000, y: (0.1 * (line + 1) + H / 2) * 1000 },
    view: VIEW,
    origin: { x: 0, y: 100 },
    offsets: { main: 500, cross: 0 },
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

type SetupOptions = { screenReader?: boolean; systemConfirmsCopy?: boolean };

function setup(
  load: (page: number) => Promise<PageText> = () => Promise.resolve(fixture()),
  { screenReader = true, systemConfirmsCopy = false }: SetupOptions = {},
) {
  const store = createReaderStore(0);
  const loader = jest.fn(load);
  const setClipboard = jest.fn((_text: string) => Promise.resolve(true));
  const shareText = jest.fn((_text: string) => Promise.resolve({}));
  const announce = jest.fn<void, [string]>();
  const controller = createSelectionController({
    docId: 'doc-1',
    store,
    cache: createTextRectsCache(loader),
    setClipboard,
    shareText,
    announce,
    isScreenReaderEnabled: () => screenReader,
    systemConfirmsCopy: () => systemConfirmsCopy,
  });
  const selection = () => store.getState().selection;
  return { store, loader, setClipboard, shareText, announce, controller, selection };
}

beforeEach(() => {
  useToastStore.setState({ current: null });
});

describe('createSelectionController', () => {
  it('selects the word under the press and announces its length', async () => {
    const { controller, selection, announce } = setup();
    controller.selectAt(pressAt(0, 7));
    await flush();
    expect(selection()).toMatchObject({ page: 0, anchor: 6, focus: 7 });
    expect(announce).toHaveBeenCalledWith('Selected: 2 characters');
    expect(controller.isActive()).toBe(true);
  });

  it('copies the text with a line break between lines, then clears', async () => {
    const { controller, selection, setClipboard } = setup();
    controller.selectAt(pressAt(0, 10));
    await flush();
    // Drag the end handle to "ɗaya".
    controller.dragHandle('focus', pressAt(1, 6).point);
    await controller.copy();
    expect(setClipboard).toHaveBeenCalledWith('zuwa\nƙasa ɗa');
    expect(useToastStore.getState().current?.message).toBe('Copied');
    expect(selection()).toBeNull();
  });

  it('shares the text, then clears', async () => {
    const { controller, selection, shareText } = setup();
    controller.selectAt(pressAt(1, 1));
    await flush();
    await controller.share();
    expect(shareText).toHaveBeenCalledWith('ƙasa');
    expect(selection()).toBeNull();
  });

  it('keeps the selection and offers a retry when copying fails', async () => {
    const { controller, selection, setClipboard } = setup();
    setClipboard.mockRejectedValueOnce(new Error('clipboard busy'));
    controller.selectAt(pressAt(0, 1));
    await flush();
    await controller.copy();
    expect(selection()).not.toBeNull();
    const shown = useToastStore.getState().current;
    expect(shown?.actionLabel).toBe('Try again');
    shown?.onAction?.();
    await flush();
    expect(setClipboard).toHaveBeenCalledTimes(2);
    expect(selection()).toBeNull();
  });

  it('swaps the handles when they cross', async () => {
    const { controller, selection } = setup();
    controller.selectAt(pressAt(0, 10));
    await flush();
    controller.dragHandle('focus', pressAt(0, 0).point);
    const current = selection();
    expect(current?.focus).toBe(0);
    expect(current?.anchor).toBe(9);
  });

  it('announces drags at most once per interval', async () => {
    jest.useFakeTimers();
    try {
      const { controller, announce } = setup();
      controller.selectAt(pressAt(0, 10));
      await jest.runOnlyPendingTimersAsync();
      announce.mockClear();
      controller.dragHandle('focus', pressAt(1, 1).point);
      controller.dragHandle('focus', pressAt(1, 3).point);
      expect(announce).not.toHaveBeenCalled();
      jest.advanceTimersByTime(2000);
      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenLastCalledWith('Selected: 9 characters');
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows a toast on an image-only page and selects nothing', async () => {
    const { controller, selection } = setup(() =>
      Promise.resolve({ text: '', boxes: [], rotation: 0 }),
    );
    controller.selectAt(pressAt(0, 1));
    await flush();
    expect(selection()).toBeNull();
    expect(useToastStore.getState().current?.message).toBe(
      'This page is an image; text can’t be selected',
    );
  });

  it('selects nothing on a blank area and clears an earlier selection', async () => {
    const { controller, selection } = setup();
    controller.selectAt(pressAt(0, 1));
    await flush();
    controller.selectAt({ ...pressAt(0, 1), point: { x: 900, y: 900 } });
    await flush();
    expect(selection()).toBeNull();
    expect(useToastStore.getState().current).toBeNull();
  });

  it('clears when the reader scrolls away, not on settling noise', async () => {
    const { controller, selection } = setup();
    controller.selectAt(pressAt(0, 1));
    await flush();
    controller.noteScroll({ main: 501, cross: 0 });
    expect(selection()).not.toBeNull();
    controller.noteScroll({ main: 540, cross: 0 });
    expect(selection()).toBeNull();
  });

  it('drops a press still loading when the reader scrolls away', async () => {
    const { controller, selection } = setup();
    controller.selectAt(pressAt(0, 1));
    controller.noteScroll({ main: 900, cross: 0 });
    await flush();
    expect(selection()).toBeNull();
  });

  it('clears when the search opens', async () => {
    const { controller, selection, store } = setup();
    controller.selectAt(pressAt(0, 1));
    await flush();
    store.getState().setSearch({ searchOpen: true });
    expect(selection()).toBeNull();
  });

  it('retries a failed read only while the page has not moved', async () => {
    const failure = Object.assign(new Error('low memory'), { code: 'OUT_OF_MEMORY' });
    let calls = 0;
    const { controller, selection, loader } = setup(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(failure) : Promise.resolve(fixture());
    });
    controller.noteScroll({ main: 500, cross: 0 });
    controller.selectAt(pressAt(0, 1));
    await flush();
    const retry = useToastStore.getState().current?.onAction;
    controller.noteScroll({ main: 800, cross: 0 });
    retry?.();
    await flush();
    expect(loader).toHaveBeenCalledTimes(1);

    controller.noteScroll({ main: 500, cross: 0 });
    retry?.();
    await flush();
    expect(loader).toHaveBeenCalledTimes(2);
    expect(selection()).not.toBeNull();
  });

  it('treats a clipboard that refuses the text as a failure', async () => {
    const { controller, selection, setClipboard } = setup();
    setClipboard.mockResolvedValueOnce(false);
    controller.selectAt(pressAt(0, 1));
    await flush();
    await controller.copy();
    const shown = useToastStore.getState().current;
    expect(shown?.message).not.toBe('Copied');
    expect(shown?.actionLabel).toBe('Try again');
    expect(selection()).not.toBeNull();
  });

  it('leaves the confirmation to Android 13+ after copying', async () => {
    const { controller, selection, setClipboard } = setup(undefined, { systemConfirmsCopy: true });
    controller.selectAt(pressAt(0, 1));
    await flush();
    await controller.copy();
    expect(setClipboard).toHaveBeenCalledWith('Sannu');
    expect(useToastStore.getState().current).toBeNull();
    expect(selection()).toBeNull();
  });

  it('announces nothing when no screen reader is on', async () => {
    const { controller, announce } = setup(undefined, { screenReader: false });
    controller.selectAt(pressAt(0, 1));
    await flush();
    controller.dragHandle('focus', pressAt(1, 3).point);
    await new Promise<void>((resolve) => setTimeout(resolve, 1600));
    expect(announce).not.toHaveBeenCalled();
  });

  it('selects all text on a page', async () => {
    const { controller, selection, setClipboard, announce } = setup();
    controller.selectAll({
      page: 0,
      view: VIEW,
      origin: { x: 0, y: 0 },
      offsets: { main: 0, cross: 0 },
    });
    await flush();
    expect(selection()).toMatchObject({ anchor: 0, focus: 23 });
    expect(announce).toHaveBeenCalledWith('Selected: 23 characters');
    await controller.copy();
    expect(setClipboard).toHaveBeenCalledWith('Sannu da zuwa\nƙasa ɗaya');
  });

  it('is active while a long press is still loading', async () => {
    const { controller } = setup();
    controller.selectAt(pressAt(0, 1));
    expect(controller.isActive()).toBe(true);
    controller.clear();
    expect(controller.isActive()).toBe(false);
    await flush();
    expect(controller.isActive()).toBe(false);
  });

  it('ignores late results after dispose', async () => {
    let resolve: (value: PageText) => void = () => undefined;
    const { controller, selection, announce } = setup(
      () =>
        new Promise<PageText>((done) => {
          resolve = done;
        }),
    );
    controller.selectAt(pressAt(0, 1));
    controller.dispose();
    resolve(fixture());
    await flush();
    expect(selection()).toBeNull();
    expect(announce).not.toHaveBeenCalled();
    controller.selectAt(pressAt(0, 1));
    await flush();
    expect(selection()).toBeNull();
  });
});
