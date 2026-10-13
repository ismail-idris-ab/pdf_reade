import { useState } from 'react';
import { Text, TextInput } from 'react-native';

import { Dialog } from '@/components/ui';
import { useTranslation } from '@/i18n';
import { useTheme } from '@/theme';

import { parseJumpTarget } from '../layout';

export type JumpToPageDialogProps = {
  pageCount: number;
  /** 0-based page the field starts with. */
  currentPage: number;
  /** Receives the chosen 0-based page. */
  onJump: (page: number) => void;
  onDismiss: () => void;
};

/** "Go to page" dialog: accepts a whole page number from 1 to pageCount. */
export function JumpToPageDialog({
  pageCount,
  currentPage,
  onJump,
  onDismiss,
}: JumpToPageDialogProps) {
  const { t } = useTranslation();
  const { palette } = useTheme();
  const [value, setValue] = useState(String(currentPage + 1));
  const target = parseJumpTarget(value, pageCount);
  // The hint turns into an error only once something invalid is typed.
  const invalid = target === null && value.trim() !== '';

  const submit = () => {
    if (target !== null) onJump(target);
  };

  return (
    <Dialog
      visible
      testID="reader-jump"
      title={t('reader.jumpTitle')}
      onDismiss={onDismiss}
      actions={[
        { label: t('common.cancel'), onPress: onDismiss, testID: 'reader-jump-cancel' },
        {
          label: t('reader.jumpConfirm'),
          variant: 'primary',
          onPress: submit,
          disabled: target === null,
          testID: 'reader-jump-confirm',
        },
      ]}
    >
      <TextInput
        testID="reader-jump-input"
        value={value}
        onChangeText={setValue}
        accessibilityLabel={t('reader.jumpLabel', { total: pageCount })}
        keyboardType="number-pad"
        autoFocus
        selectTextOnFocus
        returnKeyType="go"
        onSubmitEditing={submit}
        placeholderTextColor={palette.muted}
        className="mt-4 min-h-12 rounded-xl border border-border bg-surface px-3 text-base text-foreground"
      />
      <Text
        testID="reader-jump-hint"
        accessibilityLiveRegion="polite"
        className={`mt-2 text-sm ${invalid ? 'text-danger' : 'text-muted'}`}
      >
        {t('reader.jumpRange', { total: pageCount })}
      </Text>
    </Dialog>
  );
}
