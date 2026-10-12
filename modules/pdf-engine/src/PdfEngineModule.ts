import { NativeModule, requireNativeModule } from 'expo';

export type ThumbnailRequest = {
  /** Unique per call, chosen by JS; used by `cancelThumbnail`. */
  requestId: string;
  /** Absolute file path or content:// URI. */
  source: string;
  /** Epoch milliseconds; part of the cache key. */
  mtime: number;
  /** Bytes; part of the cache key. */
  size: number;
  /** Target bitmap width in px, clamped natively to [48, 360]. */
  widthPx: number;
};

export type ThumbnailResult = {
  /** file:// URI of the cached WebP. */
  uri: string;
  width: number;
  height: number;
};

/**
 * One page's size as displayed, in PDF points: the page box with the page's
 * /Rotate already applied (width and height swapped for 90° / 270°). Read at
 * open without parsing page content, so it is cheap for any page count; use it
 * for layout. Overlay rectangles are in unrotated page space, so the calls that
 * return them also return the page's `rotation`. A page whose page object is
 * missing or damaged gets PDFium's default US Letter size (612 × 792) so the
 * rest of the document still opens; every call that reads that page then
 * rejects with CORRUPT_FILE (search skips it).
 */
export type PageInfo = {
  width: number;
  height: number;
};

/** A page's /Rotate in degrees clockwise. */
export type PageRotation = 0 | 90 | 180 | 270;

export type OpenedDocument = {
  /** Opaque handle for every other call; release it with `close`. */
  docId: string;
  pageCount: number;
  /** One entry per page, in page order. */
  pages: PageInfo[];
  /** True when the file uses a security handler (even if no password was needed). */
  isEncrypted: boolean;
};

export type OutlineItem = {
  title: string;
  /** 0-based target page, or null when the entry has no in-document destination. */
  page: number | null;
  children: OutlineItem[];
};

/**
 * Rectangle in normalized page space: 0–1 on both axes, relative to the
 * unrotated page box, origin top-left, y growing downward.
 */
export type NormalizedRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PageTextRects = {
  /** The page text, same as `getPageText`. */
  text: string;
  /**
   * Flat [x, y, width, height] per UTF-16 unit of `text` (length = text.length × 4),
   * normalized like NormalizedRect. Both halves of a surrogate pair carry the
   * character's box. Characters without a box (generated spaces, line breaks)
   * have all four values 0.
   */
  boxes: number[];
  /** The page's rotation, to map `boxes` onto the displayed page. */
  rotation: PageRotation;
};

export type SearchOptions = {
  matchCase?: boolean;
  wholeWord?: boolean;
};

export type SearchStarted = {
  /** Identifies this search's events and `cancelSearch` target. */
  searchId: string;
};

export type SearchResultEvent = {
  searchId: string;
  /** 0-based page index. */
  page: number;
  /** One entry per match on this page; a match wrapping lines has several rects. */
  matches: NormalizedRect[][];
  /** The page's rotation, to map `matches` onto the displayed page. */
  rotation: PageRotation;
};

export type SearchProgressEvent = {
  searchId: string;
  /** Pages searched so far (monotonic, ends at pageCount). */
  pagesSearched: number;
  pageCount: number;
};

export type SearchDoneEvent = {
  searchId: string;
  totalMatches: number;
  /**
   * null on success. Otherwise a shared error code (CANCELLED after cancelSearch
   * or close, OUT_OF_MEMORY) or a non-shared code that JS maps to UNKNOWN.
   */
  errorCode: string | null;
};

export type PdfEngineEvents = {
  onSearchResult: (event: SearchResultEvent) => void;
  onSearchProgress: (event: SearchProgressEvent) => void;
  onSearchDone: (event: SearchDoneEvent) => void;
};

/** apiVersion reported by this contract. */
export const PDF_ENGINE_API_VERSION = 3;

declare class PdfEngineNativeModule extends NativeModule<PdfEngineEvents> {
  readonly apiVersion: number;
  /**
   * Renders (or returns the cached) first-page thumbnail. Rejects with
   * PASSWORD_REQUIRED, CORRUPT_FILE, NOT_FOUND, PERMISSION_DENIED, UNSUPPORTED,
   * OUT_OF_MEMORY, NO_SPACE, CANCELLED, or a non-shared code (→ UNKNOWN).
   */
  renderThumbnail(request: ThumbnailRequest): Promise<ThumbnailResult>;
  /** Drops a queued request (it rejects with CANCELLED). Never throws. */
  cancelThumbnail(requestId: string): void;

  /**
   * Opens a PDF for reading. `source` is an absolute path, a file:// URI or a
   * content:// URI (copied into the app cache first; the copy is deleted on
   * close). Rejects with PASSWORD_REQUIRED (no password given),
   * WRONG_PASSWORD (password given but rejected), CORRUPT_FILE, NOT_FOUND,
   * PERMISSION_DENIED, UNSUPPORTED (unsupported security handler, or a virtual
   * content:// document), NO_SPACE (also when free space is too low for the
   * cache copy, checked before copying), OUT_OF_MEMORY, CANCELLED (cancelOpen,
   * or module torn down), or a non-shared code (ERR_INVALID_ARGUMENT,
   * ERR_OPEN_FAILED → UNKNOWN). An empty password counts as none.
   * `openId` is chosen by JS, unique per call, and is the cancelOpen target; an
   * openId already in flight rejects with ERR_INVALID_ARGUMENT.
   */
  open(source: string, password: string | null, openId: string): Promise<OpenedDocument>;
  /**
   * Stops an open in progress: it rejects with CANCELLED and nothing stays
   * open or copied. An unknown or finished openId is a no-op. Never throws.
   */
  cancelOpen(openId: string): void;
  /**
   * Releases the document and its cache copy, cancelling its running search.
   * Idempotent; an unknown docId is a no-op. Never rejects.
   */
  close(docId: string): Promise<void>;
  /**
   * The outline (bookmarks) tree; [] when the document has none. Titles are
   * trimmed and capped at 512 UTF-16 units; at most depth 32 and 10,000 items.
   * This and the two text calls reject with ERR_DOC_NOT_OPEN (unknown or closed
   * docId), ERR_INVALID_ARGUMENT (page out of range), CORRUPT_FILE (page cannot
   * be read), OUT_OF_MEMORY, or ERR_READ_FAILED; non-shared codes map to UNKNOWN.
   */
  getOutline(docId: string): Promise<OutlineItem[]>;
  /** Plain text of one page (0-based). */
  getPageText(docId: string, page: number): Promise<string>;
  /** Text plus a box per character, for selection. */
  getTextRects(docId: string, page: number): Promise<PageTextRects>;
  /**
   * Starts a whole-document search and resolves at once with its id. Results
   * stream as onSearchResult (pages with matches only, in page order) and
   * onSearchProgress events, and the search always ends with exactly one
   * onSearchDone. A blank query finishes immediately with 0 matches. The search
   * stops at 10,000 matches (done with errorCode null). Pages that cannot be
   * read are skipped. Rejects with ERR_DOC_NOT_OPEN for an unknown docId or
   * ERR_SEARCH_FAILED (both non-shared → UNKNOWN). Events may in principle reach
   * JS before this promise resolves; buffer events for unknown ids.
   */
  search(docId: string, query: string, options: SearchOptions): Promise<SearchStarted>;
  /** Stops a running search (its onSearchDone reports CANCELLED). Never throws. */
  cancelSearch(searchId: string): void;
}

export default requireNativeModule<PdfEngineNativeModule>('PdfEngine');
