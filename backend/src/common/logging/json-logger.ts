import { ConsoleLogger, LogLevel } from '@nestjs/common';
import { redact } from './redact';

/**
 * Every log line goes through redact(). In production (or LOG_FORMAT=json) each line is
 * one JSON object, so the host's log search can filter by level and context:
 *   {"time":"…","level":"warn","context":"AuthService","message":"…"}
 * In development it stays Nest's readable coloured output, redacted the same way.
 *
 * Request bodies are never logged anywhere in the API: not for sign-in, not for income
 * records, not on errors (the exception filter logs the method and path only).
 */
export class JsonLogger extends ConsoleLogger {
  private readonly json: boolean;

  constructor(context = 'Batoma', json = process.env.NODE_ENV === 'production' || process.env.LOG_FORMAT === 'json') {
    super(context);
    this.json = json;
  }

  protected printMessages(messages: unknown[], context = '', logLevel: LogLevel = 'log', writeStreamType?: 'stdout' | 'stderr') {
    const clean = messages.map((m) => (typeof m === 'string' ? redact(m) : m instanceof Error ? redact(m.message) : redact(JSON.stringify(m))));
    if (!this.json) return super.printMessages(clean, context, logLevel, writeStreamType);
    for (const message of clean) {
      const line = JSON.stringify({ time: new Date().toISOString(), level: logLevel, context: context || this.context, message });
      (writeStreamType === 'stderr' || logLevel === 'error' || logLevel === 'fatal' ? process.stderr : process.stdout).write(`${line}\n`);
    }
  }

  protected printStackTrace(stack: string) {
    if (!stack) return;
    if (!this.json) return super.printStackTrace(redact(stack));
    process.stderr.write(`${JSON.stringify({ time: new Date().toISOString(), level: 'error', stack: redact(stack) })}\n`);
  }
}
