import { Injectable, NotFoundException } from '@nestjs/common';
import { PlaceType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { haversineKm, AMS_ALERT_ALTITUDE_M } from '../../common/utils/geo.util';
import { uniqueSlug } from '../../common/utils/slug.util';
import { CreateDestinationDto, CreatePlaceDto, NearbyQueryDto } from './dto/place.dto';

@Injectable()
export class PlacesService {
  constructor(private prisma: PrismaService) {}

  /**
   * Curated POIs near a point. The competitive position here is not general
   * mapping — Google owns that — but the tourism layer: teahouses, viewpoints,
   * trek starts, toilets and drinking water that OSM has but nobody surfaces.
   */
  async nearby(q: NearbyQueryDto) {
    const radius = q.radiusKm ?? 5;
    // Bounding-box prefilter, then exact haversine in memory.
    const degLat = radius / 111;
    const degLng = radius / (111 * Math.cos((q.lat * Math.PI) / 180) || 1);

    const candidates = await this.prisma.place.findMany({
      where: {
        latitude: { gte: q.lat - degLat, lte: q.lat + degLat },
        longitude: { gte: q.lng - degLng, lte: q.lng + degLng },
        ...(q.types?.length ? { type: { in: q.types } } : {}),
      },
      take: 500,
    });

    return candidates
      .map((p) => ({ ...p, distanceKm: +haversineKm(q.lat, q.lng, p.latitude, p.longitude).toFixed(2) }))
      .filter((p) => p.distanceKm <= radius)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, q.limit ?? 50);
  }

  listByType(type: PlaceType) {
    return this.prisma.place.findMany({ where: { type }, orderBy: { name: 'asc' } });
  }

  /** Bounding-box fetch for the offline map overlay. */
  inBounds(minLat: number, minLng: number, maxLat: number, maxLng: number) {
    return this.prisma.place.findMany({
      where: {
        latitude: { gte: minLat, lte: maxLat },
        longitude: { gte: minLng, lte: maxLng },
      },
      take: 1000,
      select: {
        id: true, name: true, nameNe: true, type: true,
        latitude: true, longitude: true, altitudeM: true, isVerified: true,
      },
    });
  }

  create(dto: CreatePlaceDto) {
    return this.prisma.place.create({ data: dto });
  }

  // ---------- destinations ----------

  listDestinations(q?: string) {
    return this.prisma.destination.findMany({
      where: q ? { name: { contains: q, mode: 'insensitive' } } : undefined,
      orderBy: { name: 'asc' },
      select: {
        id: true, slug: true, name: true, nameNe: true, district: true,
        province: true, latitude: true, longitude: true, heroImageUrl: true,
      },
    });
  }

  /** Editors add the places they want itineraries for; the slug is derived and kept unique. */
  async createDestination(dto: CreateDestinationDto) {
    const slug = await uniqueSlug(dto.name, async (s) =>
      !!(await this.prisma.destination.findUnique({ where: { slug: s }, select: { id: true } })));
    return this.prisma.destination.create({ data: { ...dto, slug } });
  }

  async getDestination(slug: string) {
    const dest = await this.prisma.destination.findUnique({
      where: { slug },
      include: {
        places: { take: 100 },
        businesses: {
          where: { isActive: true },
          orderBy: [{ tier: 'desc' }],
          take: 20,
          select: {
            id: true, slug: true, name: true, category: true, tier: true,
            priceRange: true, verifiedAt: true,
            photos: { take: 1, select: { url: true } },
          },
        },
      },
    });
    if (!dest) throw new NotFoundException('Destination not found');
    return dest;
  }

  // ---------- offline map packs ----------

  async mapPacks() {
    const packs = await this.prisma.mapPack.findMany({ orderBy: { name: 'asc' } });
    return packs.map((p) => ({
      ...p,
      sizeBytes: p.sizeBytes.toString(),
      sizeMb: +(Number(p.sizeBytes) / 1_048_576).toFixed(1),
    }));
  }

  /**
   * Altitude check for the AMS warning in Module 4. Returns guidance rather
   * than a diagnosis — this is travel information, not medical advice.
   */
  async altitudeCheck(lat: number, lng: number) {
    const near = await this.nearby({ lat, lng, radiusKm: 10, limit: 20 } as NearbyQueryDto);
    const withAltitude = near.filter((p) => p.altitudeM != null);
    const highest = withAltitude.sort((a, b) => (b.altitudeM ?? 0) - (a.altitudeM ?? 0))[0];
    const altitude = highest?.altitudeM ?? null;

    return {
      approximateAltitudeM: altitude,
      amsRiskZone: altitude != null && altitude >= AMS_ALERT_ALTITUDE_M,
      guidance:
        altitude != null && altitude >= AMS_ALERT_ALTITUDE_M
          ? [
              'Above 3,000 m, gain no more than 300–500 m of sleeping altitude per day.',
              'Take a rest day every 1,000 m of ascent.',
              'Headache, nausea, dizziness or breathlessness at rest mean you should descend.',
              'Never ascend further with symptoms. Descent is the only reliable treatment.',
            ]
          : [],
      disclaimer:
        'General travel guidance only. Seek qualified medical advice for any symptoms.',
    };
  }
}
