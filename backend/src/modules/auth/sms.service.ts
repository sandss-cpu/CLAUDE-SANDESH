import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Thin wrapper over a Nepali SMS gateway (Sparrow, AakashSMS, etc).
 * With no gateway configured the message is logged, and the OTP is
 * returned by the API so development works without credentials.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private config: ConfigService) {}

  get isConfigured(): boolean {
    return !!this.config.get<string>('SMS_GATEWAY_URL');
  }

  async send(phone: string, text: string): Promise<boolean> {
    if (!this.isConfigured) {
      this.logger.warn(`[SMS DISABLED] to ${phone}: ${text}`);
      return false;
    }
    try {
      const res = await fetch(this.config.get<string>('SMS_GATEWAY_URL'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.get<string>('SMS_GATEWAY_TOKEN')}`,
        },
        body: JSON.stringify({
          to: phone,
          text,
          from: this.config.get<string>('SMS_SENDER_ID'),
        }),
      });
      if (!res.ok) {
        this.logger.error(`SMS gateway responded ${res.status}`);
        return false;
      }
      return true;
    } catch (e) {
      this.logger.error(`SMS send failed: ${(e as Error).message}`);
      return false;
    }
  }
}
