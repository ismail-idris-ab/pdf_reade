/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  setupFiles: ['<rootDir>/jest.setup.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/'],
};
