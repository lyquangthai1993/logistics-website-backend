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

export enum AppendOrderMode {
  ROADSIDE_INBOUND = 'ROADSIDE_INBOUND',
  HUB_OUTBOUND = 'HUB_OUTBOUND',
}

export class AppendOrderToTripDto {
  @ApiPropertyOptional({
    enum: AppendOrderMode,
    default: AppendOrderMode.ROADSIDE_INBOUND,
    description:
      'Chế độ bốc thêm: ROADSIDE_INBOUND (bốc dọc đường về nhập Hub hiện tại) hoặc HUB_OUTBOUND (xuất thêm từ Hub hiện tại lên xe đi trạm kế tiếp)',
  })
  @IsOptional()
  @IsEnum(AppendOrderMode)
  appendMode?: AppendOrderMode;

  @ApiPropertyOptional({
    example: 1,
    description:
      'ID Kho xuất hàng (chỉ dùng cho HUB_OUTBOUND, mặc định là kho hiện tại của tài khoản thao tác)',
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  originHubId?: number;

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

  @ApiPropertyOptional({
    example: 'Cây xăng Hòa Cầm, QL1A',
    description: 'Điểm bốc hàng dọc đường (nhập tay)',
  })
  @IsOptional()
  @IsString()
  pickupAddress?: string;

  @ApiPropertyOptional({
    example: DeliveryDestinationMode.DIRECT_CUSTOMER,
    enum: DeliveryDestinationMode,
  })
  @IsOptional()
  @IsEnum(DeliveryDestinationMode)
  deliveryMode?: DeliveryDestinationMode;

  @ApiPropertyOptional({
    example: '123 Nguyễn Huệ, Hải Châu, Đà Nẵng',
    description: 'Điểm giao của khách (Địa chỉ giao hàng)',
  })
  @IsOptional()
  @IsString()
  deliveryAddress?: string;

  @ApiPropertyOptional({ example: 'Đà Nẵng', description: 'Tỉnh/Thành phố nhận hàng của khách' })
  @IsOptional()
  @IsString()
  province?: string;

  @ApiPropertyOptional({
    example: 2,
    description: 'ID Kho nhập hàng (mặc định lấy Kho hiện tại của tài khoản thao tác)',
  })
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
