import { setStringAsync } from 'expo-clipboard';
import { AccessibilityInfo, Platform, Share } from 'react-native';

import { showErrorToast } from '@/components/errorToast';
import { toast } from '@/components/ui';
import { formatNumber, i18n, type Locale } from '@/i18n';
import { reportError } from '@/lib/crash';
import { getTextRects } from '@/lib/engine';
import { AppError } from '@/lib/errors';

import { createThrottledAnnouncer, type ThrottledAnnouncer } from './announce';
import {
  characterCount,
  dragHandle as moveHandle,
  hasScrolledAway,
  hasSelectableText,
  selectedText,
  selectionRange,
  selectWordAt,
  wholePageRange,
  type PageText,
  type ScrollOffsets,
  type SelectionHandle,
  type SelectionRequest,
  type TextSelection,
} from './selection';
import type { ReaderStore } from './store';
import { createTextRectsCache, type TextRectsCache } from './textRectsCache';

/** Where a page is on screen, for selecting all of it (no press point). */
export type PageRequest = Omit<SelectionRequest, 'point'>;

export type SelectionController = {
  /** Selects the word under a long press (loads the page's text first, once). */
  selectAt: (request: SelectionRequest) => void;
  /** Selects all text on a page (the screen-reader action). */
  selectAll: (request: PageRequest) => void;
  /** A handle was dragged to `point` (dp on the selected page). */
  dragHandle: (handle: SelectionHandle, point: { x: number; y: number }) => void;
  /** Clears the selection and drops a long press still loading. */
  clear: () => void;
  /**
   * Whether something is selected or a long press is still loading its text
   * (a tap then clears it instead of toggling the chrome).
   */
  isActive: () => boolean;
  /** The reader scrolled: a selection made elsewhere is cleared. */
  noteScroll: (offsets: ScrollOffsets) => void;
  /** Copies the selected text to the clipboard. */
  copy: () => Promise<void>;
  /** Opens the system share sheet with the selected text. */
  share: () => Promise<void>;
  /** The reader is closing: clears everything and ignores late results. */
  dispose: () => void;
};

export type SelectionControllerOptions = {
  docId: string;
  store: ReaderStore;
  /** Defaults to the engine's getTextRects, cached per reader. */
  cache?: TextRectsCache;
  /** Resolves false when the text did not reach the clipboard. */
  setClipboard?: (text: string) => Promise<boolean>;
  shareText?: (text: string) => Promise<unknown>;
  announce?: (message: string) => void;
  /** Whether a screen reader is on (counts are only built for one). */
  isScreenReaderEnabled?: () => boolean;
  /** Whether the system shows its own "copied" confirmation (no toast then). */
  systemConfirmsCopy?: () => boolean;
};

const defaultShare = (text: string) => Share.share({ message: text });

/** Android 13 (API 33) and later confirm every clipboard write themselves. */
export function androidConfirmsCopy(): boolean {
  return Platform.OS === 'android' && Number(Platform.Version) >= 33;
}

/** Tracks whether a screen reader is on; `stop` ends the tracking. */
function trackScreenReader(): { enabled: () => boolean; stop: () => void } {
  let enabled = false;
  let stopped = false;
  AccessibilityInfo.isScreenReaderEnabled().then((value) => {
    if (!stopped) enabled = value;
  }, reportError);
  const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', (value) => {
    enabled = value;
  });
  return {
    enabled: () => enabled,
    stop: () => {
      stopped = true;
      subscription.remove();
    },
  };
}

/**
 * Text selection on the reader's pages (T2.8), kept in the reader store.
 * The selected text is only ever handed to the clipboard, the share sheet
 * and the screen reader's count announcement: it is never logged or
 * reported, and errors passed on never carry it.
 */
export function createSelectionController({
  docId,
  store,
  cache = createTextRectsCache((page) => getTextRects(docId, page)),
  setClipboard = setStringAsync,
  shareText = defaultShare,
  announce = (message) => AccessibilityInfo.announceForAccessibility(message),
  isScreenReaderEnabled,
  systemConfirmsCopy = androidConfirmsCopy,
}: SelectionControllerOptions): SelectionController {
  // Bumped whenever a pending long press must be dropped.
  let generation = 0;
  let pending: PageRequest | null = null;
  let disposed = false;
  let offsets: ScrollOffsets = { main: 0, cross: 0 };
  const announcer: ThrottledAnnouncer = createThrottledAnnouncer(announce);
  const tracker = isScreenReaderEnabled ? null : trackScreenReader();
  const screenReaderOn = isScreenReaderEnabled ?? (() => tracker?.enabled() ?? false);

  const current = () => store.getState().selection;

  /** "Selected: n characters"; builds the selected text, so only call it to announce. */
  function countMessage(selection: TextSelection): string {
    const count = characterCount(selectedText(selection.pageText, selectionRange(selection)));
    return i18n.t('reader.selection.selected', {
      count,
      value: formatNumber(count, i18n.language as Locale),
    });
  }

  function clear() {
    generation += 1;
    pending = null;
    if (current() !== null) store.getState().setSelection(null);
  }

  // Opening the search puts the reader in another mode: the selection goes.
  const unsubscribe = store.subscribe((state, previous) => {
    if (state.searchOpen && !previous.searchOpen) clear();
  });

  /**
   * Loads the page's text, then selects what `pick` chooses on it (null:
   * nothing, e.g. a blank area). Image-only pages get a toast; errors a
   * toast with a retry while the page has not moved.
   */
  function load(
    request: PageRequest,
    pick: (pageText: PageText) => { anchor: number; focus: number } | null,
  ) {
    if (disposed) return;
    generation += 1;
    const mine = generation;
    pending = request;
    cache.get(request.page).then(
      (pageText) => {
        if (disposed || mine !== generation) return;
        pending = null;
        if (!hasSelectableText(pageText)) {
          store.getState().setSelection(null);
          toast(i18n.t('reader.selection.imageOnly'));
          return;
        }
        const range = pick(pageText);
        if (range === null) {
          store.getState().setSelection(null);
          return;
        }
        const selection: TextSelection = {
          page: request.page,
          pageText,
          anchor: range.anchor,
          focus: range.focus,
          view: request.view,
          origin: request.origin,
          offsets: request.offsets,
        };
        store.getState().setSelection(selection);
        announcer.reset();
        if (screenReaderOn()) announcer.sayNow(countMessage(selection));
      },
      (error: unknown) => {
        if (disposed || mine !== generation) return;
        pending = null;
        showErrorToast(error, {
          // Again only while the page is where it was pressed.
          onRetry: () => {
            if (!hasScrolledAway(request.offsets, offsets)) load(request, pick);
          },
        });
      },
    );
  }

  function selectAt(request: SelectionRequest) {
    load(request, (pageText) => selectWordAt(pageText, request.point, request.view));
  }

  function selectAll(request: PageRequest) {
    load(request, wholePageRange);
  }

  function dragHandle(handle: SelectionHandle, point: { x: number; y: number }) {
    const selection = current();
    if (disposed || selection === null) return;
    const next = moveHandle(selection, handle, point);
    if (next === selection) return;
    store.getState().setSelection(next);
    // Built only when it is actually announced, never per move otherwise.
    if (screenReaderOn()) announcer.say(() => countMessage(next));
  }

  function noteScroll(next: ScrollOffsets) {
    offsets = next;
    const selection = current();
    if (selection && hasScrolledAway(selection.offsets, next)) clear();
    else if (pending && hasScrolledAway(pending.offsets, next)) clear();
  }

  /** The text to copy or share, or null when nothing is selected. */
  function textToSend(): string | null {
    const selection = current();
    if (selection === null) return null;
    const text = selectedText(selection.pageText, selectionRange(selection));
    return text === '' ? null : text;
  }

  async function copy() {
    const text = textToSend();
    if (text === null) return;
    try {
      const copied = await setClipboard(text);
      if (!copied) throw new AppError('UNKNOWN', 'The clipboard did not take the text');
      if (disposed) return;
      clear();
      if (!systemConfirmsCopy()) toast(i18n.t('reader.selection.copied'));
    } catch (error) {
      if (!disposed) showErrorToast(error, { onRetry: () => void copy() });
    }
  }

  async function share() {
    const text = textToSend();
    if (text === null) return;
    try {
      await shareText(text);
      if (!disposed) clear();
    } catch (error) {
      if (!disposed) showErrorToast(error, { onRetry: () => void share() });
    }
  }

  return {
    selectAt,
    selectAll,
    dragHandle,
    clear,
    isActive: () => current() !== null || pending !== null,
    noteScroll,
    copy,
    share,
    dispose: () => {
      clear();
      disposed = true;
      unsubscribe();
      announcer.dispose();
      tracker?.stop();
      cache.clear();
    },
  };
}
