import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditInput {
  actorId?: string | null;
  /** Verb in dotted form, e.g. "placement.create", "notice.delete". */
  action: string;
  entityType: string;
  entityId?: string | null;
  /** One line a person can read in a history list. */
  summary: string;
  before?: unknown;
  after?: unknown;
  routeId?: string | null;
  operatorId?: string | null;
  ip?: string | null;
}

/** Plain JSON for a jsonb column: Dates become ISO strings, undefined fields are dropped. */
function snapshot(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * The one way admin, finance and security changes are recorded. Writes go in the
 * caller's transaction when one is passed, so a change and its record either both
 * land or neither does.
 */
@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService, private config: ConfigService) {}

  record(event: AuditInput, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    return db.auditEvent.create({
      data: {
        actorId: event.actorId ?? null,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId ?? null,
        summary: event.summary.slice(0, 500),
        before: snapshot(event.before),
        after: snapshot(event.after),
        routeId: event.routeId ?? null,
        operatorId: event.operatorId ?? null,
        ipHash: event.ip ? this.hashIp(event.ip) : null,
      },
    });
  }

  /** Salted like review and report hashes, so the same address matches across them. */
  hashIp(ip: string) {
    return createHash('sha256').update(`${ip}:${this.config.get<string>('JWT_SECRET')}`).digest('hex');
  }
}
