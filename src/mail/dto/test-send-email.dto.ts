import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class TestSendEmailDto {
  @ApiProperty({
    example: 'lyquangthai1993@gmail.com',
    description: 'Địa chỉ email người nhận test',
  })
  @IsNotEmpty()
  @IsEmail()
  to: string;

  @ApiPropertyOptional({
    example: 'Thông báo thử nghiệm gửi email - Spider TMS',
    description: 'Tiêu đề email test (tùy chọn)',
  })
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiPropertyOptional({
    example: 'Hệ thống Spider TMS đã cấu hình gửi mail thành công!',
    description: 'Nội dung thông điệp kiểm tra (tùy chọn)',
  })
  @IsOptional()
  @IsString()
  message?: string;
}
