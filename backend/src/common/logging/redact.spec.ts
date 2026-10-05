import { redact, redactDeep } from './redact';

describe('redact', () => {
  it('hides email addresses and phone numbers, keeping enough to recognise them', () => {
    expect(redact('[MAIL DISABLED] to hari.sharma@example.com: Confirm')).toBe('[MAIL DISABLED] to h***@example.com: Confirm');
    expect(redact('call +977 984-123-4567 now')).toBe('call 97*********67 now');
    expect(redact('driver 9841234567')).toBe('driver 98******67');
  });

  it('leaves ordinary numbers alone', () => {
    expect(redact('Fleet reminders: 12 new across 3 companies')).toBe('Fleet reminders: 12 new across 3 companies');
    expect(redact('order 2026-10-05 at 14:30')).toBe('order 2026-10-05 at 14:30');
  });

  it('removes tokens, signatures and secrets', () => {
    expect(redact('Authorization: Bearer abc.def.ghi')).toBe('Authorization: Bearer [token]');
    expect(redact('GET /api/v1/files/k?exp=1&sig=SECRETSIG')).toBe('GET /api/v1/files/k?exp=1&sig=[redacted]');
    expect(redact('/login.html?verify=abcd1234&x=1')).toBe('/login.html?verify=[redacted]&x=1');
    expect(redact('{"password":"hunter2-hunter2","name":"Asha"}')).toBe('{"password":"[redacted]","name":"Asha"}');
    expect(redact('token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U')).toBe('token [jwt]');
  });

  it('redacts structured payloads by key and by value', () => {
    expect(redactDeep({ headers: { authorization: 'Bearer x', host: 'api' }, user: { email: 'a.b@example.com' } }))
      .toEqual({ headers: { authorization: '[redacted]', host: 'api' }, user: { email: 'a***@example.com' } });
  });
});
