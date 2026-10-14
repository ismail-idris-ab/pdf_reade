/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  // react-native-gesture-handler's documented Jest setup mocks its native module.
  setupFiles: ['<rootDir>/jest.setup.ts', 'react-native-gesture-handler/jestSetup.js'],
  // The first test in a suite pays for loading React Native and NativeWind;
  // on a cold cache or a slow CI runner that exceeds Jest's 5s default.
  testTimeout: 20000,
  testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/'],
};
