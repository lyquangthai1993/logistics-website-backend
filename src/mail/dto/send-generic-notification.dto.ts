import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  ValidateNested,
} from 'class-validator';

export class NotificationDetailPairDto {
  @ApiProperty({ example: 'Mã chuyến xe', description: 'Tên trường' })
  @IsString()
  label: string;

  @ApiProperty({ example: 'TRIP-2607-99', description: 'Giá trị' })
  @IsString()
  value: string;
}

export class SendGenericNotificationDto {
  @ApiProperty({
    example: 'lyquangthai1993+204@gmail.com',
    description: 'Email người nhận thông báo',
  })
  @IsEmail()
  to: string;

  @ApiProperty({
    example: 'Thông báo hệ thống Spider Express Logistics',
    description: 'Tiêu đề email',
  })
  @IsString()
  title: string;

  @ApiPropertyOptional({
    example: 'Anh/Chị Vận hành',
    description: 'Tên người nhận',
  })
  @IsOptional()
  @IsString()
  recipientName?: string;

  @ApiPropertyOptional({
    example: 'CẢNH BÁO HỆ THỐNG',
    description: 'Nội dung thẻ Badge',
  })
  @IsOptional()
  @IsString()
  badgeText?: string;

  @ApiPropertyOptional({
    enum: ['info', 'warning', 'danger', 'success'],
    example: 'warning',
    description: 'Màu sắc Badge (info, warning, danger, success)',
  })
  @IsOptional()
  @IsEnum(['info', 'warning', 'danger', 'success'])
  badgeType?: 'info' | 'warning' | 'danger' | 'success';

  @ApiProperty({
    example:
      'Hệ thống TMS ghi nhận sự thay đổi trạng thái quan trọng trong luồng xử lý kho.',
    description: 'Nội dung thông báo chính',
  })
  @IsString()
  message: string;

  @ApiPropertyOptional({
    type: [NotificationDetailPairDto],
    description: 'Danh sách các thông số chi tiết (Label - Value)',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NotificationDetailPairDto)
  details?: NotificationDetailPairDto[];

  @ApiPropertyOptional({
    example: 'Xem chi tiết trên TMS',
    description: 'Tên nút thao tác',
  })
  @IsOptional()
  @IsString()
  actionTitle?: string;

  @ApiPropertyOptional({
    example: 'https://tms.spiderexpress.vn',
    description: 'Link nút thao tác',
  })
  @IsOptional()
  @IsUrl()
  actionUrl?: string;

  @ApiPropertyOptional({
    example: 'Spider Express Logistics - Hệ thống quản lý vận tải đường dài',
    description: 'Chân trang email',
  })
  @IsOptional()
  @IsString()
  footerText?: string;
}
