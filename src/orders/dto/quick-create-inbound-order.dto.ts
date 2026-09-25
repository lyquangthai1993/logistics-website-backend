import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum DeliveryDestinationMode {
  DIRECT_CUSTOMER = 'DIRECT_CUSTOMER',
  HUB_L1 = 'HUB_L1',
  XE_BO = 'XE_BO',
}

export class InboundOrderItemDto {
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

  @ApiPropertyOptional({
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

  @ApiPropertyOptional({ example: 'TP.HCM', description: 'Tỉnh/Thành phố nhận hàng (nhập tự do)' })
  @IsOptional()
  @IsString()
  province?: string;

  @ApiPropertyOptional({ example: 2, description: 'ID Hub đích' })
  @IsOptional()
  @IsInt()
  @IsPositive()
  destinationHubId?: number;

  @ApiPropertyOptional({ example: '1 BCT', description: 'Chứng từ đi kèm (optional)' })
  @IsOptional()
  @IsString()
  accompanyingDocs?: string;

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

export class QuickCreateInboundOrderDto extends InboundOrderItemDto {
  @ApiProperty({
    example: '29C-123.45',
    description: 'Biển số xe tiếp nhận tại cửa kho (bắt buộc)',
  })
  @IsNotEmpty({ message: 'Biển số xe không được để trống' })
  @IsString({ message: 'Biển số xe phải là chuỗi ký tự' })
  licensePlate: string;

  @ApiPropertyOptional({
    example: 'Nguyễn Văn A',
    description: 'Họ tên tài xế / người giao hàng',
  })
  @IsOptional()
  @IsString()
  driverName?: string;

  @ApiPropertyOptional({
    example: '2026-09-24',
    description: 'Ngày tiếp nhận hàng',
  })
  @IsOptional()
  @IsString()
  receiveDate?: string;

  @ApiPropertyOptional({
    example: 'TRIP-2609-001',
    description: 'Mã chuyến xe / trip code (tùy chọn hoặc hệ thống tự cấp)',
  })
  @IsOptional()
  @IsString()
  tripCode?: string;
}

export class BatchQuickCreateInboundDto {
  @ApiProperty({
    example: '29C-123.45',
    description: 'Biển số xe tiếp nhận tại cửa kho (bắt buộc)',
  })
  @IsNotEmpty({ message: 'Biển số xe không được để trống' })
  @IsString({ message: 'Biển số xe phải là chuỗi ký tự' })
  licensePlate: string;

  @ApiPropertyOptional({
    example: 'Nguyễn Văn A',
    description: 'Họ tên tài xế / người giao hàng',
  })
  @IsOptional()
  @IsString()
  driverName?: string;

  @ApiPropertyOptional({
    example: '2026-09-24',
    description: 'Ngày tiếp nhận hàng',
  })
  @IsOptional()
  @IsString()
  receiveDate?: string;

  @ApiPropertyOptional({
    example: 'TRIP-2609-001',
    description: 'Mã chuyến xe / trip code (tùy chọn hoặc hệ thống tự cấp)',
  })
  @IsOptional()
  @IsString()
  tripCode?: string;

  @ApiProperty({
    description: 'Danh sách các dòng hàng của chuyến xe',
    type: () => [InboundOrderItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InboundOrderItemDto)
  items: InboundOrderItemDto[];
}


