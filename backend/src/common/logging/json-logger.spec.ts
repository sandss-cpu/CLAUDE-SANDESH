import { JsonLogger } from './json-logger';

describe('JsonLogger', () => {
  it('writes one redacted JSON object per line', () => {
    const out: string[] = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(String(s)); return true; });
    try {
      new JsonLogger('Test', true).warn('[MAIL DISABLED] to sita@example.com: Reset', 'MailService');
    } finally { spy.mockRestore(); }
    const line = JSON.parse(out[0]);
    expect(line).toMatchObject({ level: 'warn', context: 'MailService', message: '[MAIL DISABLED] to s***@example.com: Reset' });
    expect(Date.parse(line.time)).not.toBeNaN();
  });
});
