import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';

export enum OutboundMode {
  CUSTOMER = 'CUSTOMER',
  TRANSFER = 'TRANSFER',
}

export class OutboundItemDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  orderId: number;

  @ApiPropertyOptional({
    example: 10,
    description: 'Số kiện xuất trong đợt này',
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  quantityToExport?: number;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  weightToExport?: number;

  @ApiPropertyOptional({ example: 0.5 })
  @IsOptional()
  volumeToExport?: number;

  @ApiPropertyOptional({
    example: 2,
    description:
      'ID Hub nhận trung chuyển của đơn này (null nếu giao thẳng khách DIRECT_CUSTOMER)',
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  destinationHubId?: number;

  @ApiPropertyOptional({
    example: 'DIRECT_CUSTOMER',
    enum: ['DIRECT_CUSTOMER', 'HUB_L1', 'XE_BO'],
    description:
      'Hình thức giao hàng: DIRECT_CUSTOMER (giao thẳng khách), HUB_L1 (chuyển Hub cấp 1), XE_BO (chuyển tuyến xe bo)',
  })
  @IsOptional()
  @IsString()
  deliveryMode?: 'DIRECT_CUSTOMER' | 'HUB_L1' | 'XE_BO' | string;

  @ApiPropertyOptional({ example: 'Kho Hưng Yên hoặc địa chỉ khách' })
  @IsOptional()
  @IsString()
  deliveryAddress?: string;
}

export class ConfirmOutboundDto {
  @ApiPropertyOptional({
    example: [1, 2, 3],
    description: 'Danh sách ID đơn hàng cần xuất kho',
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  orderIds?: number[];

  @ApiPropertyOptional({
    type: [OutboundItemDto],
    description: 'Chi tiết từng đơn hàng và số lượng xuất đợt này',
  })
  @IsOptional()
  @IsArray()
  items?: OutboundItemDto[];

  @ApiProperty({ example: OutboundMode.CUSTOMER, enum: OutboundMode })
  @IsNotEmpty()
  @IsEnum(OutboundMode)
  mode: OutboundMode;

  @ApiPropertyOptional({ example: 'Nguyễn Văn A' })
  @IsOptional()
  @IsString()
  customerName?: string;

  @ApiPropertyOptional({ example: '0901234567' })
  @IsOptional()
  @IsString()
  customerPhone?: string;

  @ApiPropertyOptional({ example: '123 Lê Lợi, Q.1, TP.HCM' })
  @IsOptional()
  @IsString()
  deliveryAddress?: string;

  @ApiPropertyOptional({ example: 2, description: 'ID Hub nhận luân chuyển' })
  @IsOptional()
  @IsInt()
  @IsPositive()
  destinationHubId?: number;

  @ApiPropertyOptional({ example: '50H-123.45' })
  @IsOptional()
  @IsString()
  licensePlate?: string;

  @ApiPropertyOptional({ example: 'Nguyễn Văn B' })
  @IsOptional()
  @IsString()
  driverName?: string;

  @ApiPropertyOptional({
    example: '2026-10-05',
    description: 'Ngày xuất (YYYY-MM-DD)',
  })
  @IsOptional()
  @IsString()
  dispatchDate?: string;

  @ApiPropertyOptional({
    example: 'SD32',
    description:
      'Mã chuyến nháp đã lưu (Chờ xử lý). Lưu nháp: ghi đè nội dung nháp; Xác nhận xuất: dùng lại mã chuyến này.',
  })
  @IsOptional()
  @IsString()
  draftTripCode?: string;
}
