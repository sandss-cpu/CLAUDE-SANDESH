import { deviceLabel } from './device-label';

describe('deviceLabel', () => {
  it.each([
    ['Mozilla/5.0 (Linux; Android 14; SM-A146B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36', 'Chrome on Android'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 'Safari on iOS'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0', 'Edge on Windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox on macOS'],
    ['Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36', 'Samsung Internet on Android'],
    ['curl/8.7.1', 'An app or script'],
    ['', 'A browser'],
  ])('%s', (ua, label) => expect(deviceLabel(ua)).toBe(label));

  it('ignores versions, so an update is not a new device', () => {
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 14) Chrome/129.0.0.0 Mobile Safari/537.36'))
      .toBe(deviceLabel('Mozilla/5.0 (Linux; Android 15) Chrome/131.0.0.0 Mobile Safari/537.36'));
  });
});
