/**
 * Unit tests for the logic that does not need a database.
 *
 * The rules that decide whether a bus is overdue for service, whether a plate is
 * the same bus written differently, or whether the API is safe to boot are all
 * pure functions — they are worth testing precisely because a mistake in them is
 * silent. Anything needing Postgres is covered by scripts/fleet_smoke.sh against
 * a running API instead.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  // Nest and class-transformer decorators read design-time metadata, which does
  // not exist until this shim is loaded. main.ts imports it; tests need it too.
  setupFiles: ['reflect-metadata'],
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
};
