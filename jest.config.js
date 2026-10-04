/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  setupFiles: ['<rootDir>/jest.setup.ts'],
  // The first test in a suite pays for loading React Native and NativeWind;
  // on a cold cache or a slow CI runner that exceeds Jest's 5s default.
  testTimeout: 20000,
  testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/'],
};
