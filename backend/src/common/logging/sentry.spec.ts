import type { ErrorEvent } from '@sentry/node';
import { scrubEvent } from './sentry';

describe('scrubEvent', () => {
  it('keeps the error and drops everything personal', () => {
    const event = scrubEvent({
      type: undefined,
      message: 'Failed for asha@example.com',
      request: { method: 'POST', url: 'https://api.example/api/v1/auth/email/login?token=abc', headers: { authorization: 'Bearer x' }, data: '{"password":"p"}', cookies: { a: 'b' } },
      user: { id: 'u1', email: 'asha@example.com', ip_address: '1.2.3.4' },
      exception: { values: [{ type: 'Error', value: 'phone 9841234567 not found' }] },
      server_name: 'host-1',
    } as unknown as ErrorEvent);
    expect(event.request).toEqual({ method: 'POST', url: 'https://api.example/api/v1/auth/email/login' });
    expect(event.user).toEqual({ id: 'u1' });
    expect(event.message).toBe('Failed for a***@example.com');
    expect(event.exception!.values![0].value).toBe('phone 98******67 not found');
    expect((event as { server_name?: string }).server_name).toBeUndefined();
  });
});
