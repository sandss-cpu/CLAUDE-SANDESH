/**
 * "Chrome on Android", from a user agent. Only the browser and system families: precise
 * versions change with every update and would report the same phone as new each month.
 */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = String(userAgent ?? '');
  const browser =
    /Edg(e|A|iOS)?\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /SamsungBrowser\//.test(ua) ? 'Samsung Internet'
    : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) && /Version\//.test(ua) ? 'Safari'
    : /curl|python|okhttp|node|axios|go-http/i.test(ua) ? 'An app or script'
    : 'A browser';
  const system =
    /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Windows/.test(ua) ? 'Windows'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : null;
  return system ? `${browser} on ${system}` : browser;
}
