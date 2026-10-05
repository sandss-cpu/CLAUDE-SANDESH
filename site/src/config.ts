/** The site's settings, read once. Production refuses to start without the essentials. */
const env = (k: string) => (process.env[k] ?? '').trim();

/**
 * On Render the database address comes in parts (fromDatabase host, port and name) and the
 * read-only role's password from the API service, so the URL is put together here.
 */
function databaseUrl(): string {
  if (env('DATABASE_URL')) return env('DATABASE_URL');
  const host = env('SITE_DB_HOST');
  if (!host) return '';
  const port = env('SITE_DB_PORT') || '5432';
  return `postgresql://batoma_site:${encodeURIComponent(env('SITE_DB_PASSWORD'))}@${host}:${port}/${env('SITE_DB_NAME')}?schema=public`;
}

export const config = {
  databaseUrl: databaseUrl(),
  port: Number(env('PORT') || 4000),
  production: env('NODE_ENV') === 'production',
  /** This site's own address, for canonical links, sitemaps and share cards. */
  siteUrl: (env('SITE_URL') || 'http://localhost:4000').replace(/\/$/, ''),
  /** The Batoma API, for forms the site forwards (enquiries, newsletter). */
  apiUrl: (env('API_URL') || 'http://localhost:3000/api/v1').replace(/\/$/, ''),
  /** Shared with the API: forms are posted with it, cache purges are signed with it. */
  apiKey: env('SITE_API_KEY'),
  /** The Batoma app, where travellers sign in and write. */
  appUrl: (env('APP_URL') || 'http://localhost:5173').replace(/\/$/, ''),
  /** Salt for the visit hash; never stored, so a hash cannot be turned back into an address. */
  eventSalt: env('SITE_EVENT_SALT') || env('SITE_API_KEY') || 'dev-salt',
  /** Seconds a rendered page is served from memory before it is drawn again. */
  pageTtl: Number(env('PAGE_TTL') || 300),
};

export function checkConfig() {
  const problems: string[] = [];
  if (!config.databaseUrl) problems.push('DATABASE_URL, or SITE_DB_HOST, SITE_DB_NAME and SITE_DB_PASSWORD (the read-only batoma_site role), is required');
  if (config.production) {
    if (!/^https:\/\//.test(config.siteUrl)) problems.push('SITE_URL must be https in production');
    if (config.apiKey.length < 32) problems.push('SITE_API_KEY must be at least 32 characters in production');
    if (!/^https:\/\//.test(config.apiUrl)) problems.push('API_URL must be https in production');
  }
  if (problems.length) throw new Error(`Refusing to start:\n  • ${problems.join('\n  • ')}`);
}
