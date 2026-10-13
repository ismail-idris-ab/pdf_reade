// Stand-in for the native PdfPageView, which has no implementation in Jest.
// Test files install it with:
//   jest.mock('../../modules/pdf-engine/src/PdfPageView', () =>
//     jest.requireActual('../engine/fakePdfPageView').createFakePdfPageViewModule());
//
// The fake renders a host View (testID defaults to `pdf-page-view-<page>`)
// with every prop passed through, so tests can read `docId`, `renderScale`,
// `nightMode`… from the host node and drive the native events with
// `fireEvent(node, 'rendered', { nativeEvent })` / `fireEvent(node, 'renderError', …)`.
import { createElement } from 'react';
import { View } from 'react-native';

import type {
  PageRenderedEvent,
  PageRenderErrorEvent,
  PdfPageViewProps,
} from '../../modules/pdf-engine/src/PdfPageView';

/** A NativeSyntheticEvent-shaped payload for fireEvent. */
export function nativeEvent<T extends PageRenderedEvent | PageRenderErrorEvent>(payload: T) {
  return { nativeEvent: payload };
}

export function createFakePdfPageViewModule() {
  function PdfPageView(props: PdfPageViewProps) {
    return createElement(View, { testID: `pdf-page-view-${props.page}`, ...props });
  }
  return { __esModule: true, PdfPageView: jest.fn(PdfPageView) };
}
