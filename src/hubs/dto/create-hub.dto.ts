import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateHubDto {
  @ApiProperty({ example: 'HUB-HAN-01' })
  @IsNotEmpty()
  @IsString()
  code: string;

  @ApiPropertyOptional({ example: 'HAN' })
  @IsOptional()
  @IsString()
  orderCodePrefix?: string;

  @ApiProperty({ example: 'Andromeda Hub' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: 'Hà Nội' })
  @IsNotEmpty()
  @IsString()
  city: string;

  @ApiPropertyOptional({
    example: 'KCN Bắc Thăng Long, Huyện Đông Anh, Hà Nội',
  })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: '024-3886-1234' })
  @IsOptional()
  @IsString()
  contactPhone?: string;

  @ApiPropertyOptional({ example: 'Nguyễn Văn Quản' })
  @IsOptional()
  @IsString()
  managerName?: string;

  @ApiPropertyOptional({ example: 1, default: 1, description: '1: Hub Cấp 1, 2: Hub Cấp 2 / Xe bo' })
  @IsOptional()
  level?: number;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
