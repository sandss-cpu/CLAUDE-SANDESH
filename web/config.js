/*
 * Runtime configuration. The Render static-site build overwrites this file
 * from the BATO_API_URL and BATO_SITE_URL environment variables; locally it points at the dev API.
 */
window.BATO_CONFIG = {
  api: 'http://localhost:3000/api/v1',
  /** The public website (site/), for links to a partner's own page. */
  site: 'http://localhost:4000',
};
