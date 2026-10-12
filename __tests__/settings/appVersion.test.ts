import { readAppVersion } from '@/features/settings/appVersion';

describe('readAppVersion', () => {
  it('reads the version name and ignores the config build number', () => {
    expect(readAppVersion({ version: '1.2.3' })).toBe('1.2.3');
  });

  it('returns null without a version', () => {
    expect(readAppVersion({ version: '' })).toBeNull();
    expect(readAppVersion({})).toBeNull();
    expect(readAppVersion(null)).toBeNull();
    expect(readAppVersion(undefined)).toBeNull();
  });
});
