import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';

export enum DeliveryDestinationMode {
  DIRECT_CUSTOMER = 'DIRECT_CUSTOMER',
  HUB_L1 = 'HUB_L1',
  XE_BO = 'XE_BO',
}

export class QuickCreateInboundOrderDto {
  @ApiPropertyOptional({
    example: 'HCM-LTV-2609-011',
    description: 'Mã vận đơn (nhập tự do hoặc để trống để hệ thống tự cấp)',
  })
  @IsOptional()
  @IsString()
  orderCode?: string;

  @ApiPropertyOptional({ example: 'Vải cuộn may mặc' })
  @IsOptional()
  @IsString()
  goodsDescription?: string;

  @ApiPropertyOptional({ example: 50, description: 'Số thùng / số kiện' })
  @IsOptional()
  @IsInt({ message: 'Số thùng/kiện phải là số nguyên' })
  @Min(1, { message: 'Số thùng/kiện phải lớn hơn hoặc bằng 1' })
  totalQuantity?: number;

  @ApiPropertyOptional({ example: 1250, description: 'Số kg (Gross Weight)' })
  @IsOptional()
  @IsNumber({}, { message: 'Số kg phải là số' })
  @Min(0, { message: 'Số kg phải lớn hơn hoặc bằng 0' })
  totalWeight?: number;

  @ApiPropertyOptional({ example: 4.5, description: 'Số khối (m³ / CBM)' })
  @IsOptional()
  @IsNumber({}, { message: 'Số khối m³ phải là số' })
  @Min(0, { message: 'Số khối phải lớn hơn hoặc bằng 0' })
  totalVolume?: number;

  @ApiPropertyOptional({ example: 'KCN Thăng Long II, Hưng Yên' })
  @IsOptional()
  @IsString()
  pickupAddress?: string;

  @ApiProperty({
    example: DeliveryDestinationMode.HUB_L1,
    enum: DeliveryDestinationMode,
  })
  @IsOptional()
  @IsEnum(DeliveryDestinationMode)
  deliveryMode?: DeliveryDestinationMode;

  @ApiPropertyOptional({ example: '123 Nguyễn Huệ, Q.1, TP.HCM' })
  @IsOptional()
  @IsString()
  deliveryAddress?: string;

  @ApiPropertyOptional({ example: 2, description: 'ID Hub đích' })
  @IsOptional()
  @IsInt()
  @IsPositive()
  destinationHubId?: number;

  @ApiPropertyOptional({ example: 'Hàng dễ ướt, bốc nhẹ tay' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    example: 'INBOUND',
    description: 'Trạng thái ban đầu (INBOUND = LƯU KHO, DRAFT = Nháp)',
  })
  @IsOptional()
  @IsString()
  initialStatus?: string;
}
