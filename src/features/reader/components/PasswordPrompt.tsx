import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  AppState,
  Keyboard,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { LockIcon, VisibilityIcon, VisibilityOffIcon } from '@/components/icons';
import { Button, IconButton } from '@/components/ui';
import { useTranslation } from '@/i18n';
import { useTheme } from '@/theme';

import { useKeyboardOverlap, type MeasureInWindow } from '../useKeyboardOverlap';

/** Wait after a rejection before the field is focused again, ms. */
export const REFOCUS_DELAY_MS = 100;

export type PasswordPromptProps = {
  /** A submitted password is being tried. */
  checking: boolean;
  /** Passwords rejected so far; each new rejection clears the field. */
  failedAttempts: number;
  onSubmit: (password: string) => void;
  onCancel: () => void;
};

/** Whether TalkBack (or another screen reader) is on, kept current. */
function useScreenReaderEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isScreenReaderEnabled().then(
      (value) => {
        if (active) setEnabled(value);
      },
      () => undefined,
    );
    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', setEnabled);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return enabled;
}

/**
 * Asks for the password of a protected PDF, in place of the pages. Drawn in
 * the reader screen rather than in a dialog: there is nothing behind it to
 * keep visible, and the top bar's Back and the system back act as usual. The
 * app draws edge to edge, so the window does not shrink for the keyboard:
 * the form pads itself by the part the keyboard covers and scrolls to its
 * end, keeping the field, the status line and both buttons visible.
 *
 * The typed password stays in this component's state only; it is handed to
 * `onSubmit` and never stored. Autofill is off so the system never offers to
 * save it, a shown password uses the visible-password keyboard so the
 * keyboard does not learn it, and a shown password is hidden again when the
 * app leaves the foreground (so it is not in the Recents preview).
 */
export function PasswordPrompt({
  checking,
  failedAttempts,
  onSubmit,
  onCancel,
}: PasswordPromptProps) {
  const { t } = useTranslation();
  const { palette } = useTheme();
  const [value, setValue] = useState('');
  // The value last handed to onSubmit, until its outcome is known.
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const frameRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  const screenReader = useScreenReaderEnabled();

  // A rejected password is cleared for the next try, unless something else
  // was typed while it was checked.
  const [seenFailures, setSeenFailures] = useState(failedAttempts);
  if (seenFailures !== failedAttempts) {
    setSeenFailures(failedAttempts);
    if (submitted !== null && value === submitted) setValue('');
    setSubmitted(null);
  }
  useEffect(() => {
    // With a screen reader, moving focus would cut off the error announcement
    // (it is also the field's hint); the user moves there themselves.
    if (failedAttempts === 0 || checking || screenReader) return undefined;
    // After a rejection the field can still hold focus while Android has
    // already closed the keyboard, and focus() on a focused field does
    // nothing. Once the re-render has settled, blur and focus again: that
    // always brings the keyboard back for the next try.
    const timer = setTimeout(() => {
      const input = inputRef.current;
      if (!input) return;
      if (input.isFocused()) input.blur();
      input.focus();
    }, REFOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [failedAttempts, checking, screenReader]);

  // Leaving the foreground hides a shown password.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') setShown(false);
    });
    return () => subscription.remove();
  }, []);

  // The prompt goes when the document opens (or the user leaves): the
  // keyboard goes with it instead of covering the first page.
  useEffect(() => () => Keyboard.dismiss(), []);

  const measure = useCallback<MeasureInWindow>((callback) => {
    frameRef.current?.measureInWindow(callback);
  }, []);
  const keyboardRoom = useKeyboardOverlap(measure);
  useEffect(() => {
    if (keyboardRoom > 0) scrollRef.current?.scrollToEnd({ animated: true });
  }, [keyboardRoom]);

  const canSubmit = value.length > 0 && !checking;
  const submit = () => {
    if (!canSubmit) return;
    setSubmitted(value);
    onSubmit(value);
  };

  const wrongPassword = failedAttempts > 0 && !checking;
  const status = checking
    ? { text: t('reader.checkingPassword'), className: 'text-muted' }
    : wrongPassword
      ? { text: t('errors.WRONG_PASSWORD.message'), className: 'text-danger' }
      : null;

  return (
    <View
      ref={frameRef}
      testID="reader-password"
      className="flex-1"
      collapsable={false}
      style={{ paddingBottom: keyboardRoom }}
    >
      <ScrollView
        ref={scrollRef}
        testID="reader-password-scroll"
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="px-6 pb-6 pt-6"
      >
        <View className="items-center gap-3">
          <LockIcon color={palette.muted} size={40} />
          <Text
            accessibilityRole="header"
            className="w-full text-center text-lg font-semibold text-foreground"
          >
            {t('errors.PASSWORD_REQUIRED.title')}
          </Text>
          <Text className="w-full text-center text-base text-muted">
            {t('errors.PASSWORD_REQUIRED.message')}
          </Text>
        </View>
        <View className="mt-5 min-h-12 flex-row items-center rounded-xl border border-border bg-surface pl-3">
          <TextInput
            ref={inputRef}
            testID="reader-password-input"
            value={value}
            onChangeText={setValue}
            accessibilityLabel={t('reader.passwordLabel')}
            accessibilityHint={wrongPassword ? t('errors.WRONG_PASSWORD.message') : undefined}
            placeholder={t('reader.passwordLabel')}
            placeholderTextColor={palette.muted}
            secureTextEntry={!shown}
            keyboardType={shown ? 'visible-password' : 'default'}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            autoComplete="off"
            importantForAutofill="no"
            spellCheck={false}
            returnKeyType="go"
            // Keeps the keyboard up while the password is checked, for a retry.
            submitBehavior="submit"
            onSubmitEditing={submit}
            className="min-h-12 flex-1 text-base text-foreground"
          />
          <IconButton
            testID="reader-password-toggle"
            icon={
              shown ? (
                <VisibilityOffIcon color={palette.foreground} />
              ) : (
                <VisibilityIcon color={palette.foreground} />
              )
            }
            accessibilityLabel={t(shown ? 'reader.hidePassword' : 'reader.showPassword')}
            onPress={() => setShown((current) => !current)}
          />
        </View>
        <Text
          testID="reader-password-status"
          accessibilityLiveRegion="polite"
          className={`mt-2 min-h-5 text-sm ${status?.className ?? 'text-muted'}`}
        >
          {status?.text ?? ''}
        </Text>
        <Text className="mt-1 text-sm text-muted">{t('reader.passwordNotSaved')}</Text>
        <View className="mt-5 flex-row flex-wrap justify-end gap-2">
          <Button
            testID="reader-password-cancel"
            label={t('common.cancel')}
            variant="ghost"
            onPress={onCancel}
          />
          <Button
            testID="reader-password-open"
            label={t('reader.openWithPassword')}
            variant="primary"
            disabled={value.length === 0}
            loading={checking}
            onPress={submit}
          />
        </View>
      </ScrollView>
    </View>
  );
}
