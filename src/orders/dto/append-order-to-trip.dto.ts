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
import { DeliveryDestinationMode } from './quick-create-inbound-order.dto';

export class AppendOrderToTripDto {
  @ApiPropertyOptional({
    example: 'HCM-LTV-2609-011',
    description: 'Mã vận đơn (nhập tự do hoặc để trống để hệ thống tự cấp)',
  })
  @IsOptional()
  @IsString()
  orderCode?: string;

  @ApiProperty({ example: 'Hạt nhựa công nghiệp', description: 'Tên hàng hóa bốc thêm' })
  @IsNotEmpty({ message: 'Tên hàng hóa không được để trống' })
  @IsString()
  goodsDescription: string;

  @ApiProperty({ example: 50, description: 'Số thùng / số kiện' })
  @IsNotEmpty({ message: 'Số thùng/kiện không được để trống' })
  @IsInt({ message: 'Số thùng/kiện phải là số nguyên' })
  @Min(1, { message: 'Số thùng/kiện phải lớn hơn hoặc bằng 1' })
  totalQuantity: number;

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

  @ApiPropertyOptional({ example: 'Magellan Hub - Đà Nẵng', description: 'Địa chỉ nhận/nơi bốc' })
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

  @ApiPropertyOptional({ example: 'Hưng Yên', description: 'Tỉnh/Thành phố nhận hàng' })
  @IsOptional()
  @IsString()
  province?: string;

  @ApiPropertyOptional({ example: 1, description: 'ID Hub đích dỡ hàng (Polaris Hub - Hưng Yên)' })
  @IsOptional()
  @IsInt()
  @IsPositive()
  destinationHubId?: number;

  @ApiPropertyOptional({ example: '1 BCT', description: 'Chứng từ đi kèm' })
  @IsOptional()
  @IsString()
  accompanyingDocs?: string;

  @ApiPropertyOptional({ example: 'Bốc thêm dọc đường tại kho Đà Nẵng' })
  @IsOptional()
  @IsString()
  notes?: string;
}
