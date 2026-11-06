import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class QueryHubDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 10;

  @ApiPropertyOptional({
    description: 'Tìm kiếm theo mã kho, tên kho, thành phố, địa chỉ, quản lý',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Alias tìm kiếm theo tên/mã chi nhánh (từ bộ lọc cột name)',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Lọc theo trạng thái hoạt động' })
  @IsOptional()
  @Transform(({ value }) => {
    if (
      value === 'true' ||
      value === true ||
      value === 'active' ||
      value === 'ACTIVE'
    )
      return true;
    if (
      value === 'false' ||
      value === false ||
      value === 'inactive' ||
      value === 'INACTIVE'
    )
      return false;
    return undefined;
  })
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Alias lọc theo trạng thái (active / inactive)',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    description: 'Lọc theo phân cấp (1: Hub Cấp 1, 2: Hub Cấp 2 / Xe bo)',
    example: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2)
  @IsOptional()
  level?: number;

  @ApiPropertyOptional({
    description:
      'Sắp xếp theo cột (JSON array [{"id":"status","desc":true}] hoặc field:ASC|DESC)',
    example: '[{"id":"status","desc":true}]',
  })
  @IsOptional()
  @IsString()
  sort?: string;
}
