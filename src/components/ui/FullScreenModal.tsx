import type { ReactNode } from 'react';
import { Modal, useWindowDimensions, View } from 'react-native';

type FullScreenModalProps = {
  visible: boolean;
  onRequestClose: () => void;
  /** Flexbox alignment of the content inside the full-window root. */
  className?: string;
  children: ReactNode;
};

/**
 * Transparent Modal whose content root covers the whole app window. Android
 * 15+ draws windows edge to edge, but React Native lays out the Modal's root
 * as if the status and navigation bars were excluded (measured on Android 16:
 * root height = window − 93px − 135px), so bottom-aligned content stopped
 * short of the window edge. Sizing the root to the window height fixes that.
 * useWindowDimensions keeps it correct in split-screen, pop-up windows and
 * on fold/unfold. Children must pad themselves with the safe-area insets.
 */
export function FullScreenModal({
  visible,
  onRequestClose,
  className = '',
  children,
}: FullScreenModalProps) {
  const { height } = useWindowDimensions();

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="fade"
      onRequestClose={onRequestClose}
    >
      <View className={className} style={{ height }}>
        {children}
      </View>
    </Modal>
  );
}
