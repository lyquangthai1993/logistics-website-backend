import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { NotificationType } from '../domain/notification';

export class CreateNotificationDto {
  @ApiProperty({ example: 1 })
  @IsNumber()
  userId: number;

  @ApiProperty({ example: 'Đơn hàng mới' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'Đơn hàng #ORD-001 đã được tạo.' })
  @IsString()
  @IsNotEmpty()
  body: string;

  @ApiProperty({
    enum: ['WAREHOUSE', 'FLEET', 'DISPATCHER', 'GENERIC'],
    default: 'GENERIC',
  })
  @IsOptional()
  type?: NotificationType;

  @ApiPropertyOptional()
  @IsOptional()
  metadata?: Record<string, unknown>;
}
