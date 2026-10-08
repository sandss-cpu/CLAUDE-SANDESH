import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AdminListingDto, CreateAdminListingDto } from './admin-listing.dto';

const check = <T extends object>(cls: new () => T, plain: Record<string, unknown>) => {
  // The same conversion the API's ValidationPipe uses (app.setup.ts).
  const dto = plainToInstance(cls, plain, { enableImplicitConversion: true });
  return { dto, errors: validateSync(dto).map((e) => e.property) };
};
const base = { name: 'Hilltop Homestay', category: 'HOMESTAY' };

describe('AdminListingDto', () => {
  it('accepts the smallest listing: a name and a kind', () => {
    expect(check(AdminListingDto, base).errors).toEqual([]);
  });

  it('treats empty fields as cleared, never as 0 or an empty string', () => {
    const { dto, errors } = check(AdminListingDto, {
      ...base, description: '', destinationId: '', phone: '', website: '', ownerEmail: '', latitude: '', longitude: '',
    });
    expect(errors).toEqual([]);
    expect(dto).toMatchObject({ description: null, destinationId: null, phone: null, website: null, ownerEmail: null, latitude: null, longitude: null });
  });

  it('reads the map pin sent as text and keeps it on the globe', () => {
    expect(check(AdminListingDto, { ...base, latitude: '27.9431', longitude: '84.4164' }).dto).toMatchObject({ latitude: 27.9431, longitude: 84.4164 });
    expect(check(AdminListingDto, { ...base, latitude: '127' }).errors).toContain('latitude');
    expect(check(AdminListingDto, { ...base, longitude: 'east' }).errors).toContain('longitude');
  });

  it('refuses an unknown kind, a website without https and a phone with letters', () => {
    expect(check(AdminListingDto, { ...base, category: 'CASINO' }).errors).toContain('category');
    expect(check(AdminListingDto, { ...base, website: 'bandipur.com' }).errors).toContain('website');
    expect(check(AdminListingDto, { ...base, website: 'javascript:alert(1)' }).errors).toContain('website');
    expect(check(AdminListingDto, { ...base, phone: 'call me' }).errors).toContain('phone');
    expect(check(AdminListingDto, { ...base, phone: '+977 (61) 460-123' }).errors).toEqual([]);
  });

  it('allows twelve photos and no more', () => {
    const urls = (n: number) => Array.from({ length: n }, (_, i) => `https://x/${i}.jpg`);
    expect(check(AdminListingDto, { ...base, photoUrls: urls(12) }).errors).toEqual([]);
    expect(check(AdminListingDto, { ...base, photoUrls: urls(13) }).errors).toContain('photoUrls');
  });

  it("trims the name and checks the owner's email", () => {
    expect(check(AdminListingDto, { ...base, name: '  Hilltop Homestay ' }).dto.name).toBe('Hilltop Homestay');
    expect(check(AdminListingDto, { ...base, name: ' A ' }).errors).toContain('name');
    expect(check(AdminListingDto, { ...base, ownerEmail: 'not an email' }).errors).toContain('ownerEmail');
  });
});

describe('CreateAdminListingDto', () => {
  it('needs to know whether Batoma checked it', () => {
    expect(check(CreateAdminListingDto, base).errors).toContain('verify');
    expect(check(CreateAdminListingDto, { ...base, verify: false }).errors).toEqual([]);
  });

  it('asks how it was checked only when it is verified at once', () => {
    expect(check(CreateAdminListingDto, { ...base, verify: true }).errors).toContain('verificationNote');
    expect(check(CreateAdminListingDto, { ...base, verify: true, verificationNote: ' ok ' }).errors).toContain('verificationNote');
    expect(check(CreateAdminListingDto, { ...base, verify: true, verificationNote: 'Visited; saw the PAN certificate' }).errors).toEqual([]);
  });
});
