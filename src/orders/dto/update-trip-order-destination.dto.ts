import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator';

export enum DeliveryModeEnum {
  DIRECT_CUSTOMER = 'DIRECT_CUSTOMER',
  HUB_L1 = 'HUB_L1',
  XE_BO = 'XE_BO',
}

export class UpdateTripOrderDestinationDto {
  @ApiProperty({
    description: 'Hình thức giao nhận (Giao khách tận nơi, Hub Cấp 1, Tuyến Xe Bo)',
    enum: DeliveryModeEnum,
    example: DeliveryModeEnum.HUB_L1,
  })
  @IsEnum(DeliveryModeEnum, {
    message: 'Hình thức giao nhận phải là DIRECT_CUSTOMER, HUB_L1 hoặc XE_BO',
  })
  deliveryMode: DeliveryModeEnum;

  @ApiPropertyOptional({
    description: 'ID Hub đích đến (bắt buộc khi HUB_L1 hoặc XE_BO; null khi DIRECT_CUSTOMER)',
    example: 2,
    nullable: true,
  })
  @IsOptional()
  @IsInt({ message: 'ID Hub đích phải là số nguyên' })
  destinationHubId?: number | null;

  @ApiPropertyOptional({
    description: 'Địa chỉ giao khách hoặc tên Hub/Xe bo đích đến',
    example: 'Polaris Hub - Hưng Yên',
    nullable: true,
  })
  @IsOptional()
  @IsString({ message: 'Địa chỉ giao hàng phải là chuỗi ký tự' })
  deliveryAddress?: string | null;

  @ApiPropertyOptional({
    description: 'Ghi chú thay đổi đích đến',
    example: 'Điều chuyển phân loại tại Polaris Hub Hưng Yên',
  })
  @IsOptional()
  @IsString({ message: 'Ghi chú phải là chuỗi ký tự' })
  notes?: string;
}
