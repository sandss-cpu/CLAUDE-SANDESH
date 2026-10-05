import { MIN_PASSWORD_LENGTH, passwordProblem } from './password-policy';

describe('passwordProblem', () => {
  it('needs ten characters', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
    expect(passwordProblem('Short1!x')).toMatch(/at least 10/);
    expect(passwordProblem('tea garden lantern')).toBeNull();
  });

  it('refuses common passwords, and common words with digits or symbols added', () => {
    expect(passwordProblem('1234567890')).toMatch(/most common/);
    expect(passwordProblem('qwertyuiop')).toMatch(/most common/);
    expect(passwordProblem('password2024!')).toMatch(/most common/);
    expect(passwordProblem('Monkey123456')).toMatch(/most common/);
    expect(passwordProblem('aaaaaaaaaaaa')).toMatch(/repeated/);
  });

  it('refuses the service name and the person’s own name or email', () => {
    expect(passwordProblem('ilovebatoma99')).toMatch(/Batoma/);
    expect(passwordProblem('Sita-Gurung-1987', { name: 'Sita Gurung' })).toMatch(/name/);
    expect(passwordProblem('hari.traveller.2026', { email: 'hari.traveller@example.com' })).toMatch(/email/);
  });

  it('accepts long passphrases', () => {
    expect(passwordProblem('rhododendron morning bus', { name: 'Asha', email: 'asha@example.com' })).toBeNull();
  });
});
