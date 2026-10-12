import { create } from 'zustand';

import type { ReceivedImage } from './types';

type ReceivedImagesState = {
  images: ReceivedImage[];
  setImages: (images: ReceivedImage[]) => void;
};

/**
 * Hand-off for a SEND/SEND_MULTIPLE of images (T1.6): the router stores the
 * cached copies here right before navigating to /image-to-pdf, since an
 * array of objects does not fit typed route params. Holds only the most
 * recent hand-off; a new one replaces it, and the screen clears it once read
 * so a later direct navigation to the route does not show a stale list.
 */
export const useReceivedImagesStore = create<ReceivedImagesState>()((set) => ({
  images: [],
  setImages: (images) => set({ images }),
}));
