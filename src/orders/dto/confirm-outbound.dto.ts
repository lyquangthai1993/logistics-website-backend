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

export class ConfirmOutboundDto {
  @ApiProperty({
    example: [1, 2, 3],
    description: 'Danh sách ID đơn hàng cần xuất kho',
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'Cần chọn ít nhất 1 đơn hàng để xuất kho' })
  @IsInt({ each: true })
  orderIds: number[];

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
