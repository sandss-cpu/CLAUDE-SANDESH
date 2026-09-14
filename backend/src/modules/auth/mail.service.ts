import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';

/**
 * SMTP sender for verification and reset links. Works with any provider
 * (Resend, Brevo, Mailgun, SES). With no SMTP configured the message is
 * logged and, outside production only, the link is returned in the API
 * response so development works without credentials.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transport: Transporter | null = null;

  constructor(private config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    if (host) {
      const port = Number(this.config.get('SMTP_PORT') ?? 587);
      this.transport = createTransport({
        host,
        port,
        secure: port === 465,
        auth: {
          user: this.config.get<string>('SMTP_USER'),
          pass: this.config.get<string>('SMTP_PASS'),
        },
      });
    }
  }

  get isConfigured(): boolean {
    return !!this.transport;
  }

  async send(to: string, subject: string, text: string, html: string): Promise<boolean> {
    if (!this.transport) {
      this.logger.warn(`[MAIL DISABLED] to ${to}: ${subject}`);
      return false;
    }
    try {
      await this.transport.sendMail({
        from: this.config.get<string>('MAIL_FROM') ?? 'Bato <no-reply@bato.travel>',
        to, subject, text, html,
      });
      return true;
    } catch (e) {
      this.logger.error(`Mail send failed: ${(e as Error).message}`);
      return false;
    }
  }

  /** One plain layout for every transactional email. */
  linkEmail(opts: { heading: string; intro: string; cta: string; url: string; footer: string }) {
    const text = `${opts.heading}\n\n${opts.intro}\n\n${opts.url}\n\n${opts.footer}`;
    const html = `
      <div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;padding:24px;color:#1C1A2E">
        <p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#5B3FA8;margin:0">Bato</p>
        <h1 style="font-size:24px;margin:8px 0 16px">${opts.heading}</h1>
        <p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6">${opts.intro}</p>
        <p style="margin:24px 0">
          <a href="${opts.url}" style="background:#F4A024;color:#231600;padding:12px 22px;border-radius:10px;
             text-decoration:none;font-family:Arial,sans-serif;font-weight:bold">${opts.cta}</a>
        </p>
        <p style="font-family:Arial,sans-serif;font-size:12px;color:#5A5568;line-height:1.5">
          ${opts.footer}<br>If the button doesn't work, paste this link into your browser:<br>${opts.url}
        </p>
      </div>`;
    return { text, html };
  }
}
