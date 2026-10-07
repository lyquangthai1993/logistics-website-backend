import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  ArrayMinSize,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';

export class AppendStoredOrdersDto {
  @ApiProperty({
    description:
      'Danh sách ID đơn hàng lưu kho được chọn để xuất lên chuyến xe',
    example: [101, 102],
    type: [Number],
  })
  @IsArray({ message: 'Danh sách ID đơn hàng phải là một mảng' })
  @ArrayMinSize(1, {
    message: 'Phải chọn ít nhất 1 đơn hàng lưu kho để xuất lên xe',
  })
  @IsInt({ each: true, message: 'ID đơn hàng phải là số nguyên' })
  orderIds: number[];

  @ApiPropertyOptional({
    description: 'ID Hub đích đến tùy chọn (được gán nếu đơn chưa có Hub đích)',
    example: 2,
  })
  @IsOptional()
  @IsInt({ message: 'ID Hub đích phải là số nguyên' })
  destinationHubId?: number;

  @ApiPropertyOptional({
    description: 'ID kho xuất của tài khoản đang thao tác (tùy chọn)',
    example: 2,
  })
  @IsOptional()
  @IsInt({ message: 'ID kho xuất phải là số nguyên' })
  hubId?: number;

  @ApiPropertyOptional({
    description: 'Ghi chú xuất kho bổ sung',
    example: 'Xuất thêm từ kho lên xe đi tiếp',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
