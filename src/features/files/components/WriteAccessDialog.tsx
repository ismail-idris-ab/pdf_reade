import { useEffect } from 'react';

import { Dialog } from '@/components/ui';
import { useTranslation } from '@/i18n';

import { answerWriteAccessExplainer, useWriteAccessExplainerStore } from '../sharedWriteAccess';

const cancel = () => answerWriteAccessExplainer(false);
const proceed = () => answerWriteAccessExplainer(true);

/**
 * The short explanation shown before Android 8–10 asks for the storage
 * write permission (see ensureSharedWriteAccess). Continue goes on to the
 * system prompt; Cancel, back and the backdrop cancel the action. Unmounting
 * while it is open cancels too, so a pending action never hangs.
 */
export function WriteAccessDialog() {
  const { t } = useTranslation();
  const open = useWriteAccessExplainerStore((state) => state.resolve !== null);

  useEffect(() => cancel, []);

  return (
    <Dialog
      visible={open}
      testID="write-access-dialog"
      title={t('fileActions.writeAccessTitle')}
      message={t('fileActions.writeAccessMessage')}
      onDismiss={cancel}
      actions={[
        { label: t('common.cancel'), onPress: cancel, testID: 'write-access-cancel' },
        {
          label: t('fileActions.writeAccessContinue'),
          variant: 'primary',
          onPress: proceed,
          testID: 'write-access-continue',
        },
      ]}
    />
  );
}
