import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

export class QueryTripStatsDto {
  @ApiPropertyOptional({
    description: 'Ngày bắt đầu thống kê (ISO date). Mặc định: đầu tháng hiện tại.',
    example: '2026-08-01',
  })
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @ApiPropertyOptional({
    description: 'Ngày kết thúc thống kê (ISO date). Mặc định: hôm nay.',
    example: '2026-08-31',
  })
  @IsOptional()
  @IsDateString()
  toDate?: string;
}

