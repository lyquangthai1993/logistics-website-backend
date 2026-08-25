import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class SendTestNotificationDto {
  @ApiProperty({
    example: 1,
    description: 'ID của tài khoản người dùng cần nhận thông báo',
  })
  @IsNumber()
  @IsNotEmpty()
  userId: number;

  @ApiProperty({
    example: '⚡ Thông báo thử nghiệm WebSocket',
    description: 'Tiêu đề thông báo',
  })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({
    example: 'Nội dung thông báo thử nghiệm từ Swagger UI',
    description: 'Nội dung chi tiết của thông báo',
  })
  @IsString()
  @IsNotEmpty()
  message: string;
}
