/**
 * The end-to-end tests run against a throwaway database (scripts/test-db.sh), never the
 * one development or production uses: they sign in as other companies and try to change
 * things. Refuse to start against anything whose name does not end in "_test".
 */
const url = process.env.DATABASE_URL ?? '';
if (!/\/[\w-]+_test(\?|$)/.test(url)) {
  throw new Error('Set DATABASE_URL to a database whose name ends in _test (bash scripts/test-db.sh makes batoma_test).');
}
process.env.THROTTLE_DISABLED = 'true';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
