import { router } from 'expo-router';
import { useEffect, useRef } from 'react';

import { getRepositories } from '@/db/client';
import { useOnboardingStore } from '@/features/onboarding/store';
import { reportError } from '@/lib/crash';
import { getLaunchIntent, onIncomingIntent, type IncomingIntent } from '@/lib/files';

import { readerHref } from '../reader/navigation';
import { handleIncomingIntent } from './handleIncomingIntent';
import { useReceivedImagesStore } from './store';
import type { IntentRouteTarget } from './types';

function routeTo(target: IntentRouteTarget): void {
  switch (target.type) {
    case 'open':
      router.replace(readerHref(target.fileId));
      return;
    case 'library':
      // /index sits behind the onboarding guard; a user who just handed the
      // app several files must not be bounced to onboarding and lose them,
      // so an incomplete onboarding opens the first file instead of the
      // library (still without completing onboarding — see app/_layout.tsx).
      if (useOnboardingStore.getState().onboardingComplete) {
        router.replace('/');
      } else {
        router.replace(readerHref(target.firstFileId));
      }
      return;
    case 'imageToPdf':
      useReceivedImagesStore.getState().setImages(target.images);
      router.replace('/image-to-pdf');
      return;
  }
}

function process(intent: IncomingIntent): void {
  void handleIncomingIntent(getRepositories(), intent).then((target) => {
    if (target) routeTo(target);
  });
}

/**
 * Wires up T1.6's incoming-intent hand-off. Mount once, after migrations
 * have succeeded (repositories must be ready).
 *
 * Cold start: `getLaunchIntent()` is read once (it also consumes the intent
 * natively, so a remount cannot see it again); a `ref` guards against this
 * effect itself running twice in the same mount (e.g. React's dev-mode
 * double-invoke). Warm start: `onIncomingIntent` delivers intents that
 * arrive while the app is already running, for as long as this is mounted.
 * Either way the hand-off is processed exactly once.
 */
export function useIntentRouter(): void {
  const launchHandled = useRef(false);

  useEffect(() => {
    if (launchHandled.current) return;
    launchHandled.current = true;
    let intent: IncomingIntent | null;
    try {
      intent = getLaunchIntent();
    } catch (error) {
      reportError(error);
      return;
    }
    if (intent) process(intent);
  }, []);

  useEffect(() => {
    const subscription = onIncomingIntent(process);
    return () => subscription.remove();
  }, []);
}
