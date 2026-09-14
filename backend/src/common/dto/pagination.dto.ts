import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class PaginationDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number = 20;

  @IsOptional() @IsString()
  q?: string;

  get skip(): number { return ((this.page ?? 1) - 1) * (this.limit ?? 20); }
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
