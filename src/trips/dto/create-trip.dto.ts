import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateTripDto {
  @ApiProperty({ example: 1, description: 'ID đơn hàng' })
  @IsNotEmpty()
  @IsNumber()
  orderId: number;

  @ApiPropertyOptional({ example: 1, description: 'ID xe' })
  @IsOptional()
  @IsNumber()
  vehicleId?: number;

  @ApiPropertyOptional({ example: 1, description: 'ID tài xế' })
  @IsOptional()
  @IsNumber()
  driverId?: number;

  @ApiPropertyOptional({ example: '2026-08-20', description: 'Ngày lấy hàng' })
  @IsOptional()
  @IsString()
  pickupDate?: string;

  @ApiPropertyOptional({ example: '08:00', description: 'Giờ lấy hàng' })
  @IsOptional()
  @IsString()
  pickupTime?: string;

  @ApiPropertyOptional({
    example: '2026-08-22',
    description: 'Ngày dự kiến giao',
  })
  @IsOptional()
  @IsString()
  estimatedDeliveryDate?: string;

  @ApiProperty({
    example: 18500,
    description: 'Khối lượng phân bổ cho xe này (kg)',
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  weightAllocated: number;

  @ApiProperty({
    example: 45.2,
    description: 'Thể tích phân bổ cho xe này (m³)',
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  volumeAllocated: number;

  @ApiPropertyOptional({ example: 1, description: 'Thứ tự chuyến xe' })
  @IsOptional()
  @IsNumber()
  sequenceNumber?: number;

  @ApiPropertyOptional({ example: 'Ghi chú chuyến xe' })
  @IsOptional()
  @IsString()
  notes?: string;
}
