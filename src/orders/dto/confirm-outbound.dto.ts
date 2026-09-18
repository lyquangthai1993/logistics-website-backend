import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
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

  @ApiPropertyOptional({ example: 10, description: 'Số kiện xuất trong đợt này' })
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
}
