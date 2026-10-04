import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

/**
 * SUPER_ADMIN-only override of the immutable Master Contract.
 * Every call records an ADJUSTMENT invoice (old → new values + audit reason).
 */
export class AdminOverrideOrderDto {
  @ApiProperty({
    example: 'Nhập sai số kiện khi lập hợp đồng, khách xác nhận lại 9 kiện',
    description: 'Lý do điều chỉnh hợp đồng gốc (bắt buộc)',
  })
  @IsNotEmpty({ message: 'Vui lòng nhập lý do điều chỉnh hợp đồng gốc' })
  @IsString()
  @MinLength(5, { message: 'Lý do điều chỉnh cần tối thiểu 5 ký tự' })
  auditReason: string;

  @ApiPropertyOptional({ example: 9 })
  @IsOptional()
  @IsInt()
  @IsPositive()
  totalQuantity?: number;

  @ApiPropertyOptional({ example: 480 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  totalWeight?: number;

  @ApiPropertyOptional({ example: 2.4 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  totalVolume?: number;

  @ApiPropertyOptional({ example: 'Vải cuộn' })
  @IsOptional()
  @IsString()
  goodsDescription?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @IsPositive()
  originHubId?: number;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  @IsPositive()
  destinationHubId?: number;
}
