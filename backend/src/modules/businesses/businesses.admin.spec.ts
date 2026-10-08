import { BadRequestException } from '@nestjs/common';
import { BusinessCategory, BusinessTier, Role } from '@prisma/client';
import { BusinessesService } from './businesses.service';

const MEDIA = 'http://localhost:3000/uploads';
const PHOTO = `${MEDIA}/0b0c9c3e-5a3f-4a52-9a43-1d2e3f4a5b6c-1280.webp`;

function setup(users: Record<string, { id: string; email: string; role: Role; isSuspended: boolean }> = {}) {
  const prisma: any = {
    business: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }) => ({ id: 'b1', ...data, photos: [] })),
      update: jest.fn(async ({ data }) => ({ id: 'b1', name: data.name, ...data, photos: [] })),
    },
    businessPhoto: { deleteMany: jest.fn() },
    user: { findUnique: jest.fn(async ({ where }) => users[where.email] ?? null) },
    destination: { findUnique: jest.fn(async () => ({ id: 'd1' })) },
  };
  prisma.$transaction = (fn: (tx: unknown) => unknown) => fn(prisma);
  const audit = { record: jest.fn() };
  const config = { get: () => MEDIA };
  return { service: new BusinessesService(prisma, audit as any, config as any), prisma, audit };
}
const listing = (o: Record<string, unknown> = {}) => ({
  name: 'Hilltop Homestay', category: BusinessCategory.HOMESTAY, verify: true, verificationNote: 'Visited on 8 October', ...o,
}) as any;

describe('adding a listing from the control panel', () => {
  it('a checked listing is verified at once, by whoever added it', async () => {
    const { service, prisma, audit } = setup();
    await service.adminCreate(listing({ photoUrls: [PHOTO] }), 'admin-1');
    const data = prisma.business.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      slug: 'hilltop-homestay', tier: BusinessTier.VERIFIED, verifiedBy: 'admin-1', verificationNote: 'Visited on 8 October', ownerId: null,
    });
    expect(data.verifiedAt).toBeInstanceOf(Date);
    expect(data.photos.create).toEqual([{ url: PHOTO, sortOrder: 0 }]);
    expect(audit.record.mock.calls[0][0]).toMatchObject({
      action: 'business.create', summary: 'Added the listing Hilltop Homestay, verified, managed by Batoma',
    });
  });

  it('an unchecked one waits, with no verifier', async () => {
    const { service, prisma } = setup();
    await service.adminCreate(listing({ verify: false }), 'admin-1');
    expect(prisma.business.create.mock.calls[0][0].data).toMatchObject({
      tier: BusinessTier.FREE, verifiedAt: null, verifiedBy: null, verificationNote: null,
    });
  });

  it("links the owner's account, so they manage it in the partner area", async () => {
    const { service, prisma, audit } = setup({ 'owner@example.com': { id: 'u1', email: 'owner@example.com', role: Role.READER, isSuspended: false } });
    await service.adminCreate(listing({ ownerEmail: ' Owner@Example.com ' }), 'admin-1');
    expect(prisma.business.create.mock.calls[0][0].data.ownerId).toBe('u1');
    expect(audit.record.mock.calls[0][0].summary).toMatch(/owned by owner@example\.com$/);
  });

  it.each([
    ['a photo from elsewhere', listing({ photoUrls: ['https://example.com/a.jpg'] }), /Upload the photos through Batoma/],
    ['a latitude without a longitude', listing({ latitude: 27.9 }), /both the latitude and the longitude/],
    ['an email with no account', listing({ ownerEmail: 'nobody@example.com' }), /No Batoma account uses that email/],
    ['a staff account', listing({ ownerEmail: 'editor@bato.test' }), /Batoma staff account/],
    ['a suspended account', listing({ ownerEmail: 'gone@example.com' }), /suspended/],
  ])('refuses %s, and adds nothing', async (_what, dto, message) => {
    const { service, prisma, audit } = setup({
      'editor@bato.test': { id: 'e1', email: 'editor@bato.test', role: Role.EDITOR, isSuspended: false },
      'gone@example.com': { id: 'g1', email: 'gone@example.com', role: Role.READER, isSuspended: true },
    });
    await expect(service.adminCreate(dto, 'admin-1')).rejects.toThrow(BadRequestException);
    await expect(service.adminCreate(dto, 'admin-1')).rejects.toThrow(message);
    expect(prisma.business.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('a place that no longer exists is refused', async () => {
    const { service, prisma } = setup();
    prisma.destination.findUnique.mockResolvedValue(null);
    await expect(service.adminCreate(listing({ destinationId: 'd-gone' }), 'admin-1')).rejects.toThrow(/no longer exists/);
  });
});

describe('editing a listing from the control panel', () => {
  const OLD = 'https://images.example.com/old-cover.jpg';
  const existing = { id: 'b1', name: 'Hilltop Homestay', ownerId: null, owner: null, photos: [{ url: OLD }] };

  it('keeps photos the listing already has, wherever they came from, and replaces the set', async () => {
    const { service, prisma } = setup();
    prisma.business.findUnique.mockResolvedValue(existing);
    await service.adminUpdate('b1', listing({ photoUrls: [PHOTO, OLD] }), 'admin-1');
    expect(prisma.businessPhoto.deleteMany).toHaveBeenCalledWith({ where: { businessId: 'b1' } });
    expect(prisma.business.update.mock.calls[0][0].data.photos.create).toEqual([{ url: PHOTO, sortOrder: 0 }, { url: OLD, sortOrder: 1 }]);
  });

  it('but a new photo from elsewhere is refused', async () => {
    const { service, prisma } = setup();
    prisma.business.findUnique.mockResolvedValue(existing);
    await expect(service.adminUpdate('b1', listing({ photoUrls: [OLD, 'https://example.com/new.jpg'] }), 'admin-1')).rejects.toThrow(/Upload the photos through Batoma/);
    expect(prisma.business.update).not.toHaveBeenCalled();
  });

  it('says in the audit when the owner changes', async () => {
    const { service, prisma, audit } = setup({ 'owner@example.com': { id: 'u1', email: 'owner@example.com', role: Role.READER, isSuspended: false } });
    prisma.business.findUnique.mockResolvedValue(existing);
    await service.adminUpdate('b1', listing({ ownerEmail: 'owner@example.com' }), 'admin-1');
    expect(prisma.business.update.mock.calls[0][0].data.ownerId).toBe('u1');
    expect(audit.record.mock.calls[0][0].summary).toBe('Edited the listing Hilltop Homestay; owner now owner@example.com');
  });

  it('an unknown listing is a 404', async () => {
    const { service } = setup();
    await expect(service.adminUpdate('nope', listing(), 'admin-1')).rejects.toThrow('Listing not found');
  });
});
