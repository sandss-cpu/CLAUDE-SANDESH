import { Exclude, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class PaginationDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number = 20;

  @IsOptional() @IsString()
  q?: string;

  /**
   * Derived from page/limit, never sent by the caller.
   *
   * These must be excluded from transformation. class-transformer assigns every
   * incoming key onto the instance, and assigning a getter-only property throws
   * — so a request with a stray `?take=1` or `?skip=1` crashed with a 500
   * instead of being ignored, on every endpoint that paginates. Reading them in
   * services is unaffected.
   */
  @Exclude()
  get skip(): number { return ((this.page ?? 1) - 1) * (this.limit ?? 20); }

  @Exclude()
  get take(): number { return this.limit ?? 20; }
}

export interface Paged<T> {
  items: T[];
  meta: { page: number; limit: number; total: number; pages: number };
}

export function paged<T>(items: T[], total: number, dto: PaginationDto): Paged<T> {
  const limit = dto.limit ?? 20;
  const page = dto.page ?? 1;
  return { items, meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } };
}
