import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';
import { WarehouseNotificationType } from '../interfaces/logistics-mail-data.interface';

export class SendWarehouseNotificationDto {
  @ApiProperty({
    example: 'lyquangthai1993+832@gmail.com',
    description: 'Email người nhận thông báo kho',
  })
  @IsEmail()
  to: string;

  @ApiProperty({
    example: 'Xác nhận xe gom hàng về Kho Andromeda trước 17H',
    description: 'Tiêu đề email',
  })
  @IsString()
  title: string;

  @ApiPropertyOptional({
    example: 'Nguyễn Văn Khoa',
    description: 'Tên người nhận',
  })
  @IsOptional()
  @IsString()
  recipientName?: string;

  @ApiProperty({
    example: 'Kho Andromeda (Linh Trung, Thủ Đức, HCM)',
    description: 'Tên Hub / Kho trung chuyển',
  })
  @IsString()
  hubName: string;

  @ApiProperty({
    enum: WarehouseNotificationType,
    example: WarehouseNotificationType.INBOUND,
    description:
      'Loại thông báo kho (INBOUND, OUTBOUND, DEADLINE_ALERT, CAPACITY_WARNING)',
  })
  @IsEnum(WarehouseNotificationType)
  notificationType: WarehouseNotificationType;

  @ApiPropertyOptional({
    example: 'TRIP-2607-001',
    description: 'Mã chuyến xe liên quan',
  })
  @IsOptional()
  @IsString()
  tripCode?: string;

  @ApiPropertyOptional({
    example: '75H-041.73',
    description: 'Biển số xe',
  })
  @IsOptional()
  @IsString()
  vehiclePlate?: string;

  @ApiPropertyOptional({
    example: 'Lê Văn Tài',
    description: 'Tên tài xế',
  })
  @IsOptional()
  @IsString()
  driverName?: string;

  @ApiPropertyOptional({
    example: '16:45 - 17/08/2026',
    description: 'Thời gian dự kiến (ETA / Deadline)',
  })
  @IsOptional()
  @IsString()
  expectedTime?: string;

  @ApiPropertyOptional({
    example: 85,
    description: 'Tổng số kiện hàng',
  })
  @IsOptional()
  @IsNumber()
  totalPackages?: number;

  @ApiPropertyOptional({
    example: '2,400 kg',
    description: 'Tổng khối lượng (kg)',
  })
  @IsOptional()
  @IsString()
  totalWeight?: string;

  @ApiPropertyOptional({
    example: '14.5 m³',
    description: 'Tổng thể tích (m³)',
  })
  @IsOptional()
  @IsString()
  totalVolume?: string;

  @ApiPropertyOptional({
    example:
      'Ưu tiên kiểm đếm hàng gom Miền Bắc để kịp lịch xuất xe đường dài.',
    description: 'Ghi chú thêm',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    example: 'https://tms.spiderexpress.vn/warehouse/inbound/TRIP-2607-001',
    description: 'Link thao tác xử lý trên hệ thống TMS',
  })
  @IsOptional()
  @IsUrl()
  actionUrl?: string;
}
