import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Text } from 'react-native';

import {
  BottomSheet,
  Button,
  Dialog,
  EmptyState,
  IconButton,
  ListItem,
  ProgressSheet,
  toast,
  ToastHost,
  useToastStore,
} from '@/components/ui';

import { renderWithTheme } from './renderWithTheme';

describe('Button', () => {
  it('fires onPress and exposes its label to screen readers', async () => {
    const onPress = jest.fn();
    await renderWithTheme(<Button label="Compress" onPress={onPress} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Compress' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('blocks presses and reports state when disabled or loading', async () => {
    const onPress = jest.fn();
    await renderWithTheme(
      <>
        <Button label="Disabled" disabled onPress={onPress} />
        <Button label="Loading" loading onPress={onPress} />
      </>,
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Disabled' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Loading' }));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Disabled' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Loading' })).toBeBusy();
  });
});

describe('IconButton', () => {
  it('blocks presses when disabled', async () => {
    const onPress = jest.fn();
    await renderWithTheme(
      <IconButton icon={<Text>✕</Text>} accessibilityLabel="Close" disabled onPress={onPress} />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
  });

  it('is announced by its label', async () => {
    const onPress = jest.fn();
    await renderWithTheme(
      <IconButton icon={<Text>★</Text>} accessibilityLabel="Favorite" onPress={onPress} />,
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Favorite' }));
    expect(onPress).toHaveBeenCalled();
  });
});

describe('ListItem', () => {
  it('combines title and subtitle into one accessible label', async () => {
    const onPress = jest.fn();
    await renderWithTheme(<ListItem title="report.pdf" subtitle="2 MB" onPress={onPress} />);

    await fireEvent.press(screen.getByRole('button', { name: 'report.pdf, 2 MB' }));
    expect(onPress).toHaveBeenCalled();
  });

  it('is a labelled, enabled element without a handler', async () => {
    await renderWithTheme(<ListItem testID="row" title="Static row" subtitle="Info" />);
    expect(screen.queryByRole('button')).toBeNull();
    const row = screen.getByTestId('row');
    expect(row).toHaveAccessibleName('Static row, Info');
    // TalkBack would announce a disabled Pressable as "disabled".
    expect(row).not.toBeDisabled();
  });
});

describe('BottomSheet', () => {
  it('closes on backdrop tap and Android back when dismissible', async () => {
    const onClose = jest.fn();
    await renderWithTheme(
      <BottomSheet visible testID="sheet" title="Share" onClose={onClose}>
        <Text>Body</Text>
      </BottomSheet>,
    );
    expect(screen.getByRole('header', { name: 'Share' })).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('sheet-backdrop', { includeHiddenElements: true }));
    await fireEvent(screen.getByTestId('sheet'), 'requestClose');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('ignores backdrop and back when not dismissible', async () => {
    const onClose = jest.fn();
    await renderWithTheme(
      <BottomSheet visible testID="sheet" dismissible={false} onClose={onClose}>
        <Text>Body</Text>
      </BottomSheet>,
    );
    await fireEvent.press(screen.getByTestId('sheet-backdrop', { includeHiddenElements: true }));
    await fireEvent(screen.getByTestId('sheet'), 'requestClose');
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Dialog', () => {
  it('runs actions and dismisses on Android back', async () => {
    const onDelete = jest.fn();
    const onDismiss = jest.fn();
    await renderWithTheme(
      <Dialog
        visible
        testID="dialog"
        title="Delete file?"
        onDismiss={onDismiss}
        actions={[
          { label: 'Cancel', onPress: onDismiss },
          { label: 'Delete', variant: 'danger', onPress: onDelete },
        ]}
      />,
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalled();

    // Android back: the Modal's onRequestClose.
    await fireEvent(screen.getByTestId('dialog'), 'requestClose');
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe('ProgressSheet', () => {
  it('shows determinate progress and cancels only via the button', async () => {
    const onCancel = jest.fn();
    await renderWithTheme(
      <ProgressSheet
        visible
        testID="progress"
        title="Compressing"
        progress={0.42}
        cancelLabel="Cancel"
        onCancel={onCancel}
      />,
    );

    expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({
      min: 0,
      max: 100,
      now: 42,
    });

    // Android back must not abandon the operation.
    await fireEvent(screen.getByTestId('progress'), 'requestClose');
    expect(onCancel).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('clamps out-of-range progress', async () => {
    await renderWithTheme(
      <ProgressSheet visible title="x" progress={1.7} cancelLabel="Cancel" onCancel={jest.fn()} />,
    );
    expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ now: 100 });
  });
});

describe('EmptyState', () => {
  it('renders the call to action', async () => {
    const onPress = jest.fn();
    await renderWithTheme(
      <EmptyState title="No documents" action={{ label: 'Allow access', onPress }} />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Allow access' }));
    expect(onPress).toHaveBeenCalled();
  });
});

describe('Toast', () => {
  // Real timers with a short duration: fake timers deadlock RNTL 14's async act.
  beforeEach(async () => {
    await act(() => useToastStore.getState().dismiss());
  });

  it('shows and announces a message, then hides it after its duration', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    await renderWithTheme(<ToastHost />);
    await act(() => toast('Saved', { duration: 50 }));
    expect(screen.getByText('Saved')).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith('Saved');

    await waitFor(() => expect(screen.queryByText('Saved')).toBeNull());
  });

  it('runs the action and dismisses', async () => {
    const onUndo = jest.fn();
    await renderWithTheme(<ToastHost />);
    await act(() => toast('Moved to trash', { actionLabel: 'Undo', onAction: onUndo }));

    await fireEvent.press(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalled();
    expect(screen.queryByText('Moved to trash')).toBeNull();
  });

  it('replaces the current toast with a newer one', async () => {
    await renderWithTheme(<ToastHost />);
    await act(() => toast('First'));
    await act(() => toast('Second'));
    expect(screen.queryByText('First')).toBeNull();
    expect(screen.getByText('Second')).toBeOnTheScreen();
  });
});
