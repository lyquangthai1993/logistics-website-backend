import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { QueryNotificationDto } from './dto/query-notification.dto';
import { AuthGuard } from '@nestjs/passport';
import { SilentResponse } from '../common/decorators/silent-response.decorator';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({
  path: 'notifications',
  version: '1',
})
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post()
  @ApiOperation({
    summary: 'Tạo notification mới (dùng cho admin/internal trigger)',
  })
  create(@Body() dto: CreateNotificationDto) {
    return this.notificationsService.create(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Lấy danh sách notification của user hiện tại (phân trang & bộ lọc)',
  })
  findAll(
    @Request() req: { user: { id: number | string } },
    @Query() query: QueryNotificationDto,
  ) {
    const userId = Number(req.user.id);
    return this.notificationsService.findAllByUser(userId, query);
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Thống kê số lượng notification theo nghiệp vụ và trạng thái',
  })
  getStats(@Request() req: { user: { id: number | string } }) {
    return this.notificationsService.getStats(Number(req.user.id));
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Đếm số notification chưa đọc' })
  countUnread(@Request() req: { user: { id: number | string } }) {
    return this.notificationsService.countUnread(Number(req.user.id));
  }

  @Patch(':id/read')
  @SilentResponse()
  @ApiOperation({ summary: 'Đánh dấu 1 notification là đã đọc (background silent action)' })
  markAsRead(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: { user: { id: number | string } },
  ) {
    return this.notificationsService.markAsRead(id, Number(req.user.id));
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Đánh dấu tất cả notification là đã đọc' })
  markAllAsRead(@Request() req: { user: { id: number | string } }) {
    return this.notificationsService.markAllAsRead(Number(req.user.id));
  }
}
