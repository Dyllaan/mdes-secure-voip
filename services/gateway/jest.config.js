module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  setupFiles: ['<rootDir>/src/__tests__/setup.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/index.ts',
    '!src/types.d.ts',
    '!src/__tests__/**',
  ],
  coverageThreshold: {
    global: { branches: 90, functions: 85, lines: 98 },
  },
};
