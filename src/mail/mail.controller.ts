import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../roles/roles.guard';
import { Roles } from '../roles/roles.decorator';
import { RoleEnum } from '../roles/roles.enum';
import { MailService } from './mail.service';
import { TestSendEmailDto } from './dto/test-send-email.dto';

@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@ApiTags('Mail')
@Controller({
  path: 'mail',
  version: '1',
})
export class MailController {
  constructor(private readonly mailService: MailService) {}

  @Get('queue-status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Kiểm tra trạng thái Redis & Hàng đợi BullMQ (Yêu cầu JWT Token)',
    description:
      'Trả về trạng thái kết nối Redis Cloud và thống kê số lượng jobs (waiting, active, completed, failed) trong hàng đợi mail.',
  })
  @ApiResponse({
    status: 200,
    description: 'Thông tin trạng thái kết nối Redis và thống kê hàng đợi',
  })
  @ApiResponse({
    status: 401,
    description: 'Chưa đăng nhập hoặc JWT Token không hợp lệ',
  })
  async getQueueStatus() {
    return this.mailService.getQueueStatus();
  }

  @Roles(RoleEnum.SUPER_ADMIN)
  @Post('queue-clean')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Dọn sạch hàng đợi BullMQ & giải phóng Redis (Yêu cầu SUPER_ADMIN)',
    description:
      'Xóa toàn bộ jobs (completed, failed, delayed, wait) trong hàng đợi và thực thi dọn dẹp các key Redis.',
  })
  @ApiResponse({
    status: 200,
    description: 'Đã dọn dẹp hàng đợi BullMQ và Redis thành công',
  })
  @ApiResponse({
    status: 401,
    description: 'Chưa đăng nhập hoặc JWT Token không hợp lệ',
  })
  @ApiResponse({
    status: 403,
    description: 'Không có quyền truy cập (yêu cầu vai trò SUPER_ADMIN)',
  })
  async cleanQueue() {
    return this.mailService.cleanQueue();
  }

  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.DISPATCHER)
  @Post('test-send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Kiểm tra gửi email hệ thống (Yêu cầu JWT Bearer Token)',
    description:
      'Gửi email thử nghiệm qua SMTP Relay để kiểm tra kết nối và cấu hình mail service.',
  })
  @ApiResponse({
    status: 200,
    description: 'Email đã được gửi hoặc mô phỏng thành công',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: {
          type: 'string',
          example: 'Đã gửi email test thành công đến lyquangthai1993@gmail.com',
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Chưa đăng nhập hoặc JWT Token không hợp lệ',
  })
  @ApiResponse({
    status: 403,
    description:
      'Không có quyền truy cập (yêu cầu SUPER_ADMIN hoặc DISPATCHER)',
  })
  async testSendEmail(
    @Body() dto: TestSendEmailDto,
  ): Promise<{ success: boolean; message: string }> {
    const to = dto.to;
    const title = dto.subject || 'Thông báo thử nghiệm gửi email - Spider TMS';
    const message =
      dto.message ||
      'Đây là email thử nghiệm được gửi từ hệ thống Spider TMS qua SMTP Relay.';

    await this.mailService.sendGenericNotification({
      to,
      data: {
        title,
        message,
        actionUrl: '/dashboard',
      },
    });

    return {
      success: true,
      message: `Đã gửi email test thành công đến ${to}`,
    };
  }
}
