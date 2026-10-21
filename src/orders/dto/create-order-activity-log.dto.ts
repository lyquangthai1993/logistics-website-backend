import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { OrderActivityAction } from '../infrastructure/persistence/relational/entities/order-activity-log.entity';

export class CreateOrderActivityLogDto {
  @ApiPropertyOptional({ example: 19, description: 'ID của đơn hàng' })
  @IsOptional()
  @IsInt()
  orderId?: number | null;

  @ApiProperty({ example: 'NDA2610-0213', description: 'Mã vận đơn' })
  @IsNotEmpty({ message: 'orderCode không được để trống' })
  @IsString()
  orderCode: string;

  @ApiProperty({
    enum: OrderActivityAction,
    example: OrderActivityAction.DATA_RECONCILED,
    description: 'Hành động kiểm toán',
  })
  @IsNotEmpty({ message: 'action không được để trống' })
  action: OrderActivityAction | string;

  @ApiProperty({
    example: 1,
    description: 'ID người dùng thực hiện (Bắt buộc, không được null)',
  })
  @IsNotEmpty({ message: 'actorUserId không được để trống hoặc null' })
  @IsInt({ message: 'actorUserId phải là số nguyên hợp lệ' })
  actorUserId: number;

  @ApiPropertyOptional({
    example: 'admin@example.com',
    description: 'Email người thực hiện',
  })
  @IsOptional()
  @IsString()
  actorEmail?: string | null;

  @ApiPropertyOptional({
    example: 'SUPER_ADMIN',
    description: 'Vai trò người thực hiện',
  })
  @IsOptional()
  @IsString()
  actorRole?: string | null;

  @ApiProperty({
    example: 1,
    description:
      'ID Hub bến bãi phát sinh thao tác (Bắt buộc, không được null)',
  })
  @IsNotEmpty({ message: 'hubId không được để trống hoặc null' })
  @IsInt({ message: 'hubId phải là số nguyên hợp lệ' })
  hubId: number;

  @ApiPropertyOptional({
    example: 'N/A Hub',
    description: 'Tên Hub bến bãi',
  })
  @IsOptional()
  @IsString()
  hubName?: string | null;

  @ApiPropertyOptional({
    example: 'SD206',
    description: 'Mã chuyến xe liên quan',
  })
  @IsOptional()
  @IsString()
  tripCode?: string | null;

  @ApiPropertyOptional({ description: 'Giá trị trước thay đổi' })
  @IsOptional()
  @IsObject()
  oldValues?: Record<string, any> | null;

  @ApiPropertyOptional({ description: 'Giá trị sau thay đổi' })
  @IsOptional()
  @IsObject()
  newValues?: Record<string, any> | null;

  @ApiPropertyOptional({ example: 10, description: 'Số lượng kiện tác động' })
  @IsOptional()
  @IsInt()
  quantity?: number | null;

  @ApiPropertyOptional({
    example: 'Admin xóa dòng giao dịch kho',
    description: 'Lý do thao tác',
  })
  @IsOptional()
  @IsString()
  reason?: string | null;

  @ApiPropertyOptional({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description:
      'Bearer token xác thực tại thời điểm người dùng thực hiện thao tác',
  })
  @IsOptional()
  @IsString()
  bearerToken?: string | null;

  @ApiPropertyOptional({ description: 'Metadata bổ sung' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any> | null;
}
