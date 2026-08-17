import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsNumber, IsOptional, IsString, IsUrl } from 'class-validator';
import { FleetNotificationType } from '../interfaces/logistics-mail-data.interface';

export class SendFleetNotificationDto {
  @ApiPropertyOptional({
    example: 10,
    description: 'ID của user nhận in-app notification (để push WebSocket)',
  })
  @IsOptional()
  @IsNumber()
  userId?: number;
  @ApiProperty({
    example: 'lyquangthai1993+419@gmail.com',
    description: 'Email người nhận (Quản lý đội xe / Tài xế)',
  })
  @IsEmail()
  to: string;

  @ApiProperty({
    example: 'Cảnh báo vượt tải trọng chuyến xe TRIP-2607-002',
    description: 'Tiêu đề email',
  })
  @IsString()
  title: string;

  @ApiPropertyOptional({
    example: 'Nguyễn Văn Đội',
    description: 'Tên người nhận',
  })
  @IsOptional()
  @IsString()
  recipientName?: string;

  @ApiProperty({
    enum: FleetNotificationType,
    example: FleetNotificationType.OVERLOAD_ALERT,
    description:
      'Loại thông báo vận hành (TRIP_ASSIGNMENT, OVERLOAD_ALERT, TRIP_STATUS_UPDATE)',
  })
  @IsEnum(FleetNotificationType)
  notificationType: FleetNotificationType;

  @ApiProperty({
    example: 'TRIP-2607-002',
    description: 'Mã chuyến xe',
  })
  @IsString()
  tripCode: string;

  @ApiProperty({
    example: '75H-011.37',
    description: 'Biển số xe',
  })
  @IsString()
  vehiclePlate: string;

  @ApiProperty({
    example: 'Trần Văn Lái',
    description: 'Tên tài xế',
  })
  @IsString()
  driverName: string;

  @ApiProperty({
    example: 'Huế -> Kho Magellan (Đà Nẵng)',
    description: 'Tuyến đường vận chuyển',
  })
  @IsString()
  route: string;

  @ApiPropertyOptional({
    example: '8,500 kg',
    description: 'Tải trọng hiện tại',
  })
  @IsOptional()
  @IsString()
  currentWeight?: string;

  @ApiPropertyOptional({
    example: '8,000 kg',
    description: 'Tải trọng tối đa cho phép của xe',
  })
  @IsOptional()
  @IsString()
  maxPayload?: string;

  @ApiPropertyOptional({
    example: '42.5 m³',
    description: 'Thể tích hàng hiện tại',
  })
  @IsOptional()
  @IsString()
  currentVolume?: string;

  @ApiPropertyOptional({
    example: '40.0 m³',
    description: 'Thể tích tối đa xe chứa được',
  })
  @IsOptional()
  @IsString()
  maxVolume?: string;

  @ApiPropertyOptional({
    example: 'OVERLOAD',
    description:
      'Trạng thái chuyến xe (ASSIGNED, OVERLOAD, IN_TRANSIT, COMPLETED)',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    example:
      'Xe đang vượt tải trọng 500kg. Yêu cầu Quản lý xe giảm bớt 1 đơn gom trước khi phê duyệt xuất bến.',
    description: 'Ghi chú / Cảnh báo',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    example: 'https://tms.spiderexpress.vn/fleet/trips/TRIP-2607-002',
    description: 'Link phê duyệt / kiểm tra chuyến xe',
  })
  @IsOptional()
  @IsUrl()
  actionUrl?: string;
}
