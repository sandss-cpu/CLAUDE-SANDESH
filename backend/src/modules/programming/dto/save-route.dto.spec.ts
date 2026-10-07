import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SaveRouteDto } from './programming.dto';

const check = (plain: Record<string, unknown>) => {
  // The same conversion the API's ValidationPipe uses (app.setup.ts).
  const dto = plainToInstance(SaveRouteDto, plain, { enableImplicitConversion: true });
  return { dto, errors: validateSync(dto).map((e) => e.property) };
};
const base = { code: 'KTM-BGL', name: 'Kathmandu – Baglung', startPlace: 'Kathmandu', endPlace: 'Baglung' };

describe('SaveRouteDto', () => {
  it('accepts a plain route and tidies the code to capitals', () => {
    const { dto, errors } = check({ ...base, code: '  ktm-bgl ', name: '  Kathmandu – Baglung ' });
    expect(errors).toEqual([]);
    expect(dto.code).toBe('KTM-BGL');
    expect(dto.name).toBe('Kathmandu – Baglung');
  });

  it('refuses codes with other characters or a stray hyphen', () => {
    for (const code of ['KTM_BGL', 'KTM BGL', '-KTM', 'KTM-', 'KTM--BGL', 'K']) {
      expect(check({ ...base, code }).errors).toContain('code');
    }
  });

  it('treats an empty number as cleared, never as 0', () => {
    const { dto, errors } = check({ ...base, distanceKm: '', typicalHours: null });
    expect(errors).toEqual([]);
    expect(dto.distanceKm).toBeNull();
    expect(dto.typicalHours).toBeNull();
  });

  it('reads numbers sent as text, and keeps them in range', () => {
    expect(check({ ...base, distanceKm: '230', typicalHours: '6.5' }).dto).toMatchObject({ distanceKm: 230, typicalHours: 6.5 });
    expect(check({ ...base, distanceKm: 0 }).errors).toContain('distanceKm');
    expect(check({ ...base, distanceKm: 12.5 }).errors).toContain('distanceKm');
    expect(check({ ...base, typicalHours: 'soon' }).errors).toContain('typicalHours');
    expect(check({ ...base, typicalHours: 100 }).errors).toContain('typicalHours');
  });

  it('clears empty optional text', () => {
    const { dto } = check({ ...base, nameNe: '', description: '' });
    expect(dto.nameNe).toBeNull();
    expect(dto.description).toBeNull();
  });

  it('needs both places and a name', () => {
    expect(check({ ...base, startPlace: ' ' }).errors).toContain('startPlace');
    expect(check({ ...base, endPlace: undefined }).errors).toContain('endPlace');
    expect(check({ ...base, name: 'KB' }).errors).toContain('name');
  });
});
