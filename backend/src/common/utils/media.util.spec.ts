import { isOwnMediaUrl } from './media.util';

const BASE = 'https://media.batoma.example/static';
const ID = '3f2b6c1e-8a4d-4c2b-9e7f-1a2b3c4d5e6f';

describe('isOwnMediaUrl', () => {
  it('accepts what /media/upload returns: each size of an upload', () => {
    expect(isOwnMediaUrl(`${BASE}/${ID}-1280.webp`, BASE)).toBe(true);
    expect(isOwnMediaUrl(`${BASE}/${ID}-320.webp`, `${BASE}/`)).toBe(true);
  });

  it('still accepts uploads from before pictures were stored in several sizes', () => {
    expect(isOwnMediaUrl(`${BASE}/${ID}.jpg`, BASE)).toBe(true);
  });

  it('refuses anything else', () => {
    expect(isOwnMediaUrl(null, BASE)).toBe(false);
    expect(isOwnMediaUrl(`https://tracker.example/${ID}-1280.webp`, BASE)).toBe(false);
    expect(isOwnMediaUrl(`${BASE}/../api/v1/${ID}.webp`, BASE)).toBe(false);
    expect(isOwnMediaUrl(`${BASE}/${ID}-1280.svg`, BASE)).toBe(false);
    expect(isOwnMediaUrl(`${BASE}/${ID}-1280.webp?x=1`, BASE)).toBe(false);
    expect(isOwnMediaUrl(`${BASE}/${ID}-big.webp`, BASE)).toBe(false);
  });
});
