import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SmsService } from '../auth/sms.service';
import { EmergencyContactDto, SosDto } from './dto/safety.dto';

@Injectable()
export class SafetyService {
  constructor(private prisma: PrismaService, private sms: SmsService) {}

  /**
   * The whole directory, small enough to cache on the device. It has to work
   * with no connection — that is the only situation in which it matters.
   */
  async directory(district?: string) {
    const numbers = await this.prisma.emergencyNumber.findMany({
      where: district
        ? { OR: [{ district: { equals: district, mode: 'insensitive' } }, { isNational: true }] }
        : undefined,
      orderBy: [{ isNational: 'desc' }, { category: 'asc' }],
    });

    return {
      generatedAt: new Date().toISOString(),
      cacheOffline: true,
      numbers,
    };
  }

  contacts(userId: string) {
    return this.prisma.emergencyContact.findMany({ where: { userId } });
  }

  addContact(userId: string, dto: EmergencyContactDto) {
    return this.prisma.emergencyContact.create({ data: { userId, ...dto } });
  }

  async removeContact(userId: string, id: string) {
    await this.prisma.emergencyContact.deleteMany({ where: { id, userId } });
    return { deleted: true };
  }

  /**
   * SOS. Records the event and texts every saved contact with a location link.
   * The client is responsible for the SMS fallback when there is no data —
   * this endpoint only runs when a connection exists.
   */
  async sos(userId: string, dto: SosDto) {
    const event = await this.prisma.sosEvent.create({
      data: {
        userId,
        latitude: dto.latitude,
        longitude: dto.longitude,
        message: dto.message,
        channel: dto.channel ?? 'DATA',
      },
    });

    const [user, contacts] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { name: true, phone: true } }),
      this.prisma.emergencyContact.findMany({ where: { userId } }),
    ]);

    const position =
      dto.latitude != null && dto.longitude != null
        ? `https://www.google.com/maps?q=${dto.latitude},${dto.longitude}`
        : 'Location unavailable';

    const text =
      `EMERGENCY: ${user?.name ?? 'A traveller'} has triggered an SOS. ` +
      `Last known position: ${position}. ${dto.message ?? ''}`.trim();

    const notified: string[] = [];
    for (const c of contacts) {
      const ok = await this.sms.send(c.phone, text);
      if (ok) notified.push(c.phone);
    }

    return {
      eventId: event.id,
      contactsNotified: notified.length,
      totalContacts: contacts.length,
      position,
      advice: contacts.length
        ? undefined
        : 'No emergency contacts saved. Add one so alerts can reach someone.',
    };
  }
}
