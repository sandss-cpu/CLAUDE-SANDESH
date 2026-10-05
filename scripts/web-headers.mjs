/**
 * Security headers for the web app (web/): one definition, used by the local server
 * (scripts/dev-web-server.mjs) so every page is tried under the same policy it gets on
 * Render, and copied into render.yaml (a test checks the two agree).
 *
 * script-src 'self' with no 'unsafe-inline': no page or script carries inline code
 * (backend/src/common/utils/web-pages.spec.ts). style-src keeps 'unsafe-inline' for the
 * style attributes the pages still set; styles cannot run code.
 */
export function contentSecurityPolicy({ api = '', production = true } = {}) {
  const extra = api && !api.startsWith('https:') ? ` ${api}` : '';
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    `img-src 'self' data: blob: https:${extra}`,
    `media-src 'self' blob: https:${extra}`,
    // The app reaches the API through its own domain (/api/*, rewritten by the host).
    `connect-src 'self'${extra}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    ...(production ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

/** The camera only where a bus's code is scanned; location only where SOS can send it. */
export function permissionsPolicy(path) {
  if (path === '/scan.html') return 'camera=(self), geolocation=(), microphone=(), payment=(), usb=()';
  const reader = path === '/' || path === '/index.html' || /^\/[br]\//.test(path);
  return `camera=(), geolocation=${reader ? '(self)' : '()'}, microphone=(), payment=(), usb=()`;
}

export function webHeaders(path, opts = {}) {
  const production = opts.production ?? true;
  return {
    'Content-Security-Policy': contentSecurityPolicy(opts),
    'Permissions-Policy': permissionsPolicy(path),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    ...(production ? { 'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload' } : {}),
  };
}
