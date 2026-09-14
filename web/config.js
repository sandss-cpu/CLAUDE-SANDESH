/*
 * Runtime configuration. The Render static-site build overwrites this file
 * from the BATO_API_URL environment variable; locally it points at the dev API.
 */
window.BATO_CONFIG = {
  api: 'http://localhost:3000/api/v1',
};
