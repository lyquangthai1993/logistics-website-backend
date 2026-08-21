import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';

export class CreateOrderDto {
  @ApiProperty({
    example: 'NDA2608-0126',
    description: 'Mã đơn hàng do user tự nhập',
  })
  @IsNotEmpty({ message: 'Mã đơn hàng không được để trống' })
  @IsString()
  orderCode: string;

  @ApiPropertyOptional({ example: 'Hà Nội → TP.HCM' })
  @IsOptional()
  @IsString()
  route?: string;

  @ApiPropertyOptional({ example: 'Andromeda Hub (Hà Nội)' })
  @IsOptional()
  @IsString()
  originHub?: string;

  @ApiPropertyOptional({
    example: 1,
    description:
      'ID của Hub nguồn (ưu tiên hơn originHub string — dùng từ Phase 1)',
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  originHubId?: number;

  @ApiPropertyOptional({ example: 'Centaurus Hub (TP.HCM)' })
  @IsOptional()
  @IsString()
  destinationHub?: string;

  @ApiPropertyOptional({
    example: 2,
    description:
      'ID của Hub đích (ưu tiên hơn destinationHub string — dùng từ Phase 1)',
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  destinationHubId?: number;

  @ApiPropertyOptional({
    example: 3000,
    description:
      'Tổng số lượng kiện/cái (không bắt buộc, để trống nếu là hàng xá/lô gom chung)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  totalQuantity?: number | null;

  @ApiProperty({ example: 18500, description: 'Tổng khối lượng (kg)' })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  totalWeight: number;

  @ApiProperty({ example: 45.2, description: 'Tổng thể tích (m³)' })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  totalVolume: number;

  @ApiPropertyOptional({ example: 'Hàng điện tử đóng kiện tiêu chuẩn' })
  @IsOptional()
  @IsString()
  goodsDescription?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isExternalVehicleNeeded?: boolean;

  @ApiPropertyOptional({
    example:
      'Cần thuê xe tải bửng nâng 15 tấn từ nhà xe Vận Tải Á Châu do xe nội bộ đang bận',
  })
  @IsOptional()
  @IsString()
  externalNote?: string;

  @ApiPropertyOptional({ example: 'Cần bốc xếp nhẹ tay' })
  @IsOptional()
  @IsString()
  notes?: string;
}
