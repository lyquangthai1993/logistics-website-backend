import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { RolesGuard } from '../roles/roles.guard';
import { Roles } from '../roles/roles.decorator';
import { RoleEnum } from '../roles/roles.enum';
import { AdminReportsService } from './admin-reports.service';

@SkipThrottle({ default: true, auth: true })
@Throttle({
  default: { limit: 2000, ttl: 60000 },
  auth: { limit: 2000, ttl: 60000 },
})
@ApiTags('Admin Reports')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(RoleEnum.SUPER_ADMIN)
@Controller({
  path: 'admin/reports',
  version: '1',
})
export class AdminReportsController {
  constructor(private readonly adminReportsService: AdminReportsService) {}

  @Get('operational')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Báo cáo kết quả hoạt động vận hành Hub (Super Admin) — Khung 18:00 D-1 đến 18:00 D',
  })
  @ApiQuery({ name: 'fromDate', required: false, type: String })
  @ApiQuery({ name: 'toDate', required: false, type: String })
  @ApiQuery({ name: 'hubId', required: false, type: String })
  @ApiQuery({
    name: 'direction',
    required: false,
    enum: ['INBOUND', 'OUTBOUND', 'ALL'],
  })
  @ApiQuery({ name: 'monthsCount', required: false, type: Number })
  async getOperationalReport(
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('hubId') hubId?: string,
    @Query('direction') direction?: string,
    @Query('monthsCount') monthsCount?: number,
  ) {
    return this.adminReportsService.getOperationalReport({
      fromDate,
      toDate,
      hubId,
      direction,
      monthsCount: monthsCount ? Number(monthsCount) : undefined,
    });
  }

  @Post('operational/sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Kích hoạt đồng bộ / chạy tổng hợp báo cáo ngày (Cronjob 18:00 D-1 -> 18:00 D) cho khoảng thời gian chọn',
  })
  async syncOperationalReport(
    @Request() req: any,
    @Body()
    body?: {
      fromDate?: string;
      toDate?: string;
      notifySuperAdmins?: boolean;
    },
  ) {
    const latestClosed = this.adminReportsService.getLatestClosedReportDate();
    const fromDate =
      body?.fromDate && /^\d{4}-\d{2}-\d{2}$/.test(body.fromDate.trim())
        ? body.fromDate.trim()
        : latestClosed;
    const toDate =
      body?.toDate && /^\d{4}-\d{2}-\d{2}$/.test(body.toDate.trim())
        ? body.toDate.trim()
        : fromDate;

    const start = fromDate <= toDate ? fromDate : toDate;
    const maxEnd = this.adminReportsService.addDays(start, 366);
    const rawEnd = fromDate <= toDate ? toDate : fromDate;
    const end = rawEnd > maxEnd ? maxEnd : rawEnd;

    return this.adminReportsService.executeAndLogCronRun({
      fromDate: start,
      toDate: end,
      triggeredBy: start === end ? 'MANUAL_RERUN' : 'MANUAL_RANGE',
      notifySuperAdmins: Boolean(body?.notifySuperAdmins),
      actorUser: req?.user,
    });
  }

  @Get('operational/daily-trips')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Theo dõi chi tiết mã TRIP (Xe nhập kho / Xe xuất kho) trong 1 ngày báo cáo cụ thể (18:00 D-1 -> 18:00 D)',
  })
  @ApiQuery({ name: 'reportDate', required: false, type: String })
  @ApiQuery({ name: 'hubId', required: false, type: String })
  @ApiQuery({
    name: 'direction',
    required: false,
    enum: ['INBOUND', 'OUTBOUND', 'ALL'],
  })
  async getDailyTripsDetailReport(
    @Query('reportDate') reportDate?: string,
    @Query('hubId') hubId?: string,
    @Query('direction') direction?: string,
  ) {
    return this.adminReportsService.getDailyTripsDetailReport({
      reportDate,
      hubId,
      direction,
    });
  }

  @Get('cronjobs')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Lấy cấu hình Cronjob, lịch sử thực thi và trạng thái chốt sổ 30 ngày gần nhất (Super Admin)',
  })
  @ApiQuery({ name: 'daysLimit', required: false, type: Number })
  async getCronJobManagementData(@Query('daysLimit') daysLimit?: number) {
    return this.adminReportsService.getCronJobManagementData({
      daysLimit: daysLimit ? Number(daysLimit) : undefined,
    });
  }

  @Patch('cronjobs/config')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Cập nhật cấu hình Cronjob báo cáo vận hành hàng ngày (Bật/Tắt, Giờ chạy GMT+7, Thông báo)',
  })
  async updateCronJobConfig(
    @Request() req: any,
    @Body()
    body: {
      jobKey?: string;
      isEnabled?: boolean;
      cronTime?: string;
      cutoffHour?: number;
      notifySuperAdmins?: boolean;
      description?: string;
    },
  ) {
    return this.adminReportsService.updateCronJobConfig(body, req?.user);
  }

  @Post('cronjobs/rerun')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Thực thi chạy lại Report cho 1 ngày cụ thể hoặc khoảng ngày (từ ngày -> đến ngày) theo khung 18:00 D-1 -> 18:00 D',
  })
  async rerunCronReportForDate(
    @Request() req: any,
    @Body()
    body: {
      jobKey?: string;
      reportDate?: string;
      fromDate?: string;
      toDate?: string;
      triggeredBy?: 'MANUAL_RERUN' | 'MANUAL_RANGE';
      notifySuperAdmins?: boolean;
    },
  ) {
    const latestClosed = this.adminReportsService.getLatestClosedReportDate();
    const rawStart = body?.fromDate || body?.reportDate || latestClosed;
    const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(rawStart.trim())
      ? rawStart.trim()
      : latestClosed;
    const rawEnd = body?.toDate || body?.reportDate || fromDate;
    const toDate = /^\d{4}-\d{2}-\d{2}$/.test(rawEnd.trim())
      ? rawEnd.trim()
      : fromDate;

    const start = fromDate <= toDate ? fromDate : toDate;
    const maxEnd = this.adminReportsService.addDays(start, 366);
    const orderedEnd = fromDate <= toDate ? toDate : fromDate;
    const end = orderedEnd > maxEnd ? maxEnd : orderedEnd;

    const resolvedTriggeredBy =
      body?.triggeredBy === 'MANUAL_RANGE'
        ? 'MANUAL_RANGE'
        : start === end
          ? 'MANUAL_RERUN'
          : 'MANUAL_RANGE';

    return this.adminReportsService.executeAndLogCronRun({
      jobKey: body?.jobKey,
      fromDate: start,
      toDate: end,
      triggeredBy: resolvedTriggeredBy,
      notifySuperAdmins: Boolean(body?.notifySuperAdmins),
      actorUser: req?.user,
    });
  }

  @Get('regional-dispatch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Báo cáo Cân Đối Tải Trọng Đội Xe Theo Miền (Super Admin) — Phân tích Tồn kho & Sắp về theo 3 Miền (Bắc, Trung, Nam)',
  })
  @ApiQuery({ name: 'hubId', required: false, type: String })
  @ApiQuery({ name: 'date', required: false, type: String })
  @ApiQuery({ name: 'fromDate', required: false, type: String })
  @ApiQuery({ name: 'toDate', required: false, type: String })
  @ApiQuery({ name: 'mode', required: false, enum: ['live', 'snapshot'] })
  async getRegionalDispatchReport(
    @Query('hubId') hubId?: string,
    @Query('date') date?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('mode') mode?: 'live' | 'snapshot',
  ) {
    return this.adminReportsService.getRegionalDispatchReport({
      hubId,
      date,
      fromDate,
      toDate,
      mode,
    });
  }

  @Post('regional-dispatch/sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Kích hoạt tính toán & đồng bộ snapshot Cân Đối Tải Trọng Đội Xe Theo Miền ngay lập tức',
  })
  async syncRegionalDispatchSnapshot(
    @Request() req: any,
    @Body()
    body?: {
      hubId?: number;
      date?: string;
    },
  ) {
    return this.adminReportsService.calculateRegionalDispatchSnapshot({
      hubId: body?.hubId,
      date: body?.date,
      triggeredBy: 'MANUAL',
    });
  }
}
