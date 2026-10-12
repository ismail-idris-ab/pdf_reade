import { useState } from 'react';
import { Text, TextInput } from 'react-native';

import { Dialog } from '@/components/ui';
import { useTranslation } from '@/i18n';
import {
  fileOpErrorKind,
  isNameErrorKind,
  validateFileName,
  type NameErrorKind,
  type NameProblem,
} from '@/lib/files';
import { useTheme } from '@/theme';

import { useInFlight } from '../useInFlight';

export type NameDialogProps = {
  title: string;
  initialName: string;
  /** Pre-selects the name without its extension (files), so typing keeps ".pdf". */
  selectBaseName?: boolean;
  confirmLabel: string;
  /**
   * The name that will really be used for what was typed (trimmed), e.g. a
   * file keeping its extension. Validated instead of the typed text, and
   * shown under the field when it differs. Defaults to the typed name.
   */
  finalName?: (typed: string) => string;
  /**
   * Called with the trimmed typed name. Rejections with a name error
   * (ERR_NAME_INVALID / ERR_NAME_EXISTS) are shown under the field; any
   * other rejection goes to `onError`.
   */
  onSubmit: (name: string) => Promise<void>;
  onError: (error: unknown) => void;
  onDismiss: () => void;
  testID: string;
};

const PROBLEM_KEY = {
  empty: 'names.empty',
  invalidChars: 'names.invalidChars',
  leadingDot: 'names.leadingDot',
  tooLong: 'names.tooLong',
} as const satisfies Record<NameProblem, string>;

const NATIVE_KEY = {
  nameInvalid: 'names.invalid',
  nameExists: 'names.exists',
} as const satisfies Record<NameErrorKind, string>;

const identity = (name: string) => name;

/** End of the part of a file name before its extension ("report" in "report.pdf"). */
export function baseNameEnd(name: string): number {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? dot : name.length;
}

/**
 * Name entry for rename and new folder. Mount it only while it is shown, so
 * every opening starts from `initialName`. Validates as the user types
 * (mirroring the native rules), shows native name errors inline, and
 * disables Save while the operation runs.
 */
export function NameDialog({
  title,
  initialName,
  selectBaseName = false,
  confirmLabel,
  finalName = identity,
  onSubmit,
  onError,
  onDismiss,
  testID,
}: NameDialogProps) {
  const { t } = useTranslation();
  const { palette } = useTheme();
  const [value, setValue] = useState(initialName);
  const [touched, setTouched] = useState(false);
  const [nativeError, setNativeError] = useState<NameErrorKind | null>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>(() => ({
    start: 0,
    end: selectBaseName ? baseNameEnd(initialName) : initialName.length,
  }));
  const { busy, run } = useInFlight();

  const typed = value.trim();
  const final = typed === '' ? '' : finalName(typed);
  const problem = validateFileName(final);
  // Rule problems show once the user has typed; native errors until they do.
  const errorText =
    nativeError !== null
      ? t(NATIVE_KEY[nativeError])
      : touched && problem !== null
        ? t(PROBLEM_KEY[problem])
        : null;
  const preview =
    errorText === null && problem === null && final !== typed
      ? t('fileActions.savedAs', { name: final })
      : null;

  const submit = () => {
    void run(async () => {
      try {
        await onSubmit(typed);
      } catch (error) {
        const kind = fileOpErrorKind(error);
        if (isNameErrorKind(kind)) setNativeError(kind);
        else onError(error);
      }
    });
  };

  return (
    <Dialog
      visible
      testID={testID}
      title={title}
      onDismiss={busy ? () => undefined : onDismiss}
      actions={[
        {
          label: t('common.cancel'),
          onPress: onDismiss,
          disabled: busy,
          testID: `${testID}-cancel`,
        },
        {
          label: confirmLabel,
          variant: 'primary',
          onPress: submit,
          disabled: problem !== null || nativeError !== null,
          loading: busy,
          testID: `${testID}-confirm`,
        },
      ]}
    >
      <TextInput
        testID={`${testID}-input`}
        value={value}
        onChangeText={(text) => {
          setValue(text);
          setTouched(true);
          setNativeError(null);
        }}
        selection={selection}
        onSelectionChange={() => setSelection(undefined)}
        accessibilityLabel={t('fileActions.nameLabel')}
        autoFocus
        autoCorrect={false}
        editable={!busy}
        returnKeyType="done"
        onSubmitEditing={() => {
          if (problem === null && nativeError === null) submit();
        }}
        placeholderTextColor={palette.muted}
        className="mt-4 min-h-12 rounded-xl border border-border bg-surface px-3 text-base text-foreground"
      />
      {errorText !== null ? (
        <Text
          testID={`${testID}-error`}
          accessibilityLiveRegion="polite"
          className="mt-2 text-sm text-danger"
        >
          {errorText}
        </Text>
      ) : null}
      {preview !== null ? (
        <Text
          testID={`${testID}-preview`}
          accessibilityLiveRegion="polite"
          className="mt-2 text-sm text-muted"
        >
          {preview}
        </Text>
      ) : null}
    </Dialog>
  );
}
