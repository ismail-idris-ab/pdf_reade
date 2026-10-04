import { fireEvent, render, screen } from '@testing-library/react-native';

import { ErrorScreen } from '@/components/ErrorScreen';
import { AppError } from '@/lib/errors';

describe('ErrorScreen', () => {
  it('shows the human message for a retryable coded error and retries', async () => {
    const retry = jest.fn();
    await render(<ErrorScreen error={new AppError('OUT_OF_MEMORY')} retry={retry} />);

    expect(
      screen.getByRole('header', { name: 'This file is too large to handle right now' }),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('uses the generic message when the code needs a recovery other than retry', async () => {
    await render(<ErrorScreen error={new AppError('PASSWORD_REQUIRED')} retry={jest.fn()} />);
    expect(screen.getByRole('header', { name: 'Something went wrong' })).toBeOnTheScreen();
    expect(screen.queryByText(/password/i)).toBeNull();
  });

  it('falls back to a generic message without leaking the raw error', async () => {
    await render(
      <ErrorScreen
        error={new Error('ENOENT /storage/emulated/0/Download/secret.pdf')}
        retry={jest.fn()}
      />,
    );
    expect(screen.getByRole('header', { name: 'Something went wrong' })).toBeOnTheScreen();
    expect(screen.queryByText(/secret\.pdf/)).toBeNull();
  });
});
