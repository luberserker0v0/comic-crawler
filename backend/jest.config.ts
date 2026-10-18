import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(msw|rettime|strict-event-emitter|headers-polyfill|@open-draft|content-disposition)/)',
    '[\\\\/]shared[\\\\/]dist[\\\\/]',
    '[\\\\/]browser-client-sdk[\\\\/]dist[\\\\/]',
  ],
  transform: {
    '^.+\\.[tj]sx?$': [
      'ts-jest',
      {
        useESM: false,
        tsconfig: {
          allowJs: true,
        },
      },
    ],
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/main.ts',
    '!src/index.ts',
  ],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
};

export default config;
