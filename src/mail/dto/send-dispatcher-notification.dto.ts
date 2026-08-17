import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, IsUrl } from 'class-validator';
import { DispatcherNotificationType } from '../interfaces/logistics-mail-data.interface';

export class SendDispatcherNotificationDto {
  @ApiProperty({
    example: 'lyquangthai1993+756@gmail.com',
    description: 'Email Điều hành / Super Admin',
  })
  @IsEmail()
  to: string;

  @ApiProperty({
    example: 'Tiếp nhận đơn hàng mới NDA2607-8892 (Tuyến Miền Bắc)',
    description: 'Tiêu đề email',
  })
  @IsString()
  title: string;

  @ApiPropertyOptional({
    example: 'Đức Anh (Dispatcher)',
    description: 'Tên người nhận',
  })
  @IsOptional()
  @IsString()
  recipientName?: string;

  @ApiProperty({
    enum: DispatcherNotificationType,
    example: DispatcherNotificationType.NEW_ORDER,
    description:
      'Loại thông báo điều hành (NEW_ORDER, ORDER_CANCELLED, ROUTING_ALERT, DAILY_SUMMARY)',
  })
  @IsEnum(DispatcherNotificationType)
  notificationType: DispatcherNotificationType;

  @ApiProperty({
    example: 'NDA2607-8892',
    description: 'Mã đơn hàng',
  })
  @IsString()
  orderCode: string;

  @ApiPropertyOptional({
    example: 'Công ty Cổ phần Bột Giặt LIX',
    description: 'Tên khách hàng / Đối tác',
  })
  @IsOptional()
  @IsString()
  customerName?: string;

  @ApiPropertyOptional({
    example: 'Cảng TBS Tân Vạn',
    description: 'Điểm nhận hàng (Pickup)',
  })
  @IsOptional()
  @IsString()
  pickupLocation?: string;

  @ApiPropertyOptional({
    example: 'Kho Vela (Phùng Chí Kiên, Mỹ Hào, Hưng Yên)',
    description: 'Điểm giao hàng / Kho nhập (Dropoff / Inbound Hub)',
  })
  @IsOptional()
  @IsString()
  dropoffLocation?: string;

  @ApiPropertyOptional({
    example: '12 ĐƠN MIỀN BẮC',
    description: 'Ghi chú phân loại tuyến',
  })
  @IsOptional()
  @IsString()
  regionGroup?: string;

  @ApiPropertyOptional({
    example: '120 thùng hóa chất gia dụng, 1,800 kg, 9.2 m³',
    description: 'Thông tin mặt hàng, khối lượng, thể tích',
  })
  @IsOptional()
  @IsString()
  cargoInfo?: string;

  @ApiPropertyOptional({
    example: 'PENDING_DISPATCH',
    description: 'Trạng thái đơn hàng',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    example: 'Đơn hàng gấp cần lập tuyến gom về Kho Vela trước 17H00.',
    description: 'Ghi chú / Nhắc nhở điều hành',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    example: 'https://tms.spiderexpress.vn/orders/NDA2607-8892',
    description: 'Link xử lý đơn hàng',
  })
  @IsOptional()
  @IsUrl()
  actionUrl?: string;
}
