import { plainToInstance } from 'class-transformer';
import { PaginationDto, paged } from './pagination.dto';

/**
 * Regression tests for a 500 on every paginated endpoint.
 *
 * class-transformer assigns each incoming query key onto the instance. skip and
 * take are derived getters, and assigning to a getter-only property throws, so
 * `?take=1` crashed the request instead of being ignored — on public endpoints,
 * from anyone.
 */
describe('PaginationDto', () => {
  it('ignores a supplied take instead of throwing', () => {
    expect(() => plainToInstance(PaginationDto, { take: '3' })).not.toThrow();
    const dto = plainToInstance(PaginationDto, { take: '3' });
    expect(dto.take).toBe(20); // the default limit, not the supplied value
  });

  it('ignores a supplied skip instead of throwing', () => {
    expect(() => plainToInstance(PaginationDto, { skip: '5' })).not.toThrow();
    expect(plainToInstance(PaginationDto, { skip: '5' }).skip).toBe(0);
  });

  it('still derives skip and take from page and limit', () => {
    const dto = plainToInstance(PaginationDto, { page: 3, limit: 25 });
    expect(dto.take).toBe(25);
    expect(dto.skip).toBe(50);
  });

  it('defaults to the first page of twenty', () => {
    const dto = plainToInstance(PaginationDto, {});
    expect(dto.skip).toBe(0);
    expect(dto.take).toBe(20);
  });
});

describe('paged', () => {
  it('reports the page count from the total', () => {
    const dto = plainToInstance(PaginationDto, { page: 2, limit: 2 });
    expect(paged(['a', 'b'], 6, dto).meta).toEqual({ page: 2, limit: 2, total: 6, pages: 3 });
  });

  it('never reports zero pages for an empty result', () => {
    expect(paged([], 0, plainToInstance(PaginationDto, {})).meta.pages).toBe(1);
  });
});
