import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { FieldCrypto, fieldEncryptionMiddleware } from '../crypto/field-crypto';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  /** Null only in development without keys; production refuses to start without them (env.validation). */
  readonly fieldCrypto: FieldCrypto | null;

  constructor() {
    super();
    this.fieldCrypto = FieldCrypto.fromEnv();
    if (this.fieldCrypto) this.$use(fieldEncryptionMiddleware(this.fieldCrypto));
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log(this.fieldCrypto ? `Database connected; personal fields encrypted with key ${this.fieldCrypto.currentId}` : 'Database connected; FIELD_ENCRYPTION_KEYS not set, personal fields stored as plain text');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
