/** An image cached from a SEND/SEND_MULTIPLE hand-off, pending Image→PDF (T3.4). */
export type ReceivedImage = {
  path: string;
  name: string;
  size: number;
};

/**
 * Where an incoming intent (T1.6) should take the user, decided once its
 * URIs are copied and classified:
 * - `open`: a single document (ACTION_VIEW, or a SEND of one PDF-like file) —
 *   the row is already in the library at `fileId`.
 * - `library`: a SEND of several documents; `firstFileId` is a fallback
 *   destination for when the library screen is not reachable yet (see
 *   useIntentRouter's onboarding note).
 * - `imageToPdf`: a SEND of one or more images, not stored in the library.
 */
export type IntentRouteTarget =
  | { type: 'open'; fileId: number }
  | { type: 'library'; firstFileId: number }
  | { type: 'imageToPdf'; images: ReceivedImage[] };
