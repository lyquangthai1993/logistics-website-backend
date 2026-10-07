import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { RolesGuard } from '../roles/roles.guard';
import { Roles } from '../roles/roles.decorator';
import { RoleEnum } from '../roles/roles.enum';
import { WarehouseService } from './warehouse.service';
import {
  QuickCreateInboundOrderDto,
  BatchQuickCreateInboundDto,
} from './dto/quick-create-inbound-order.dto';
import { AppendOrderToTripDto } from './dto/append-order-to-trip.dto';
import { AppendStoredOrdersDto } from './dto/append-stored-orders.dto';
import { Throttle } from '@nestjs/throttler';
import { ConfirmOutboundDto } from './dto/confirm-outbound.dto';

@Throttle({ default: { limit: 600, ttl: 60000 } })
@ApiTags('Warehouse')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller({
  path: 'warehouse',
  version: '1',
})
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) {}

  @Get('orders')
  @Roles(
    RoleEnum.SUPER_ADMIN,
    RoleEnum.WAREHOUSE_MANAGER,
    RoleEnum.DISPATCHER,
    RoleEnum.FLEET_MANAGER,
  )
  @ApiOperation({
    summary:
      'Tra cứu & danh sách hàng hóa trong kho (Freetext + Status + Pagination)',
  })
  @ApiQuery({
    name: 'flow',
    required: false,
    enum: ['INBOUND', 'OUTBOUND', 'OUTBOUND_LOOKUP'],
  })
  @ApiQuery({
    name: 'ids',
    required: false,
    description: 'Danh sách id đơn, phân tách dấu phẩy',
  })
  @ApiQuery({ name: 'groupBy', required: false, enum: ['orderCode'] })
  async getOrders(
    @Request() req: any,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('flow') flow?: 'INBOUND' | 'OUTBOUND' | 'OUTBOUND_LOOKUP',
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('ids') ids?: string,
    @Query('groupBy') groupBy?: string,
  ) {
    return this.warehouseService.getOrders(req.user, {
      search,
      status,
      flow,
      page,
      limit,
      fromDate,
      toDate,
      ids,
      groupBy,
    });
  }

  @Get('kpi')
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.WAREHOUSE_MANAGER)
  @ApiOperation({
    summary:
      'Lấy chỉ số KPI tổng quan kho (Chờ nhập, Lưu kho, Chờ xuất, Đã xuất)',
  })
  async getKpi(
    @Request() req: any,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.warehouseService.getKpiStats(req.user, { fromDate, toDate });
  }

  @Get('outbound-trips')
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.WAREHOUSE_MANAGER)
  @ApiOperation({
    summary:
      'Bảng chuyến xe xuất kho (SD...) của kho hiện tại: Chờ xử lý (nháp) / Đã xử lý, lọc phụ Xuất khách / Luân chuyển',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['ALL', 'PENDING', 'COMPLETED'],
  })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: ['ALL', 'CUSTOMER', 'TRANSFER'],
  })
  async getOutboundTrips(
    @Request() req: any,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.warehouseService.getOutboundTrips(req.user, {
      search,
      status,
      type,
      fromDate,
      toDate,
      page,
      limit,
    });
  }

  @Get('inbound-trips')
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.WAREHOUSE_MANAGER)
  @ApiOperation({
    summary:
      'Danh sách chuyến xe dừng tại kho hiện tại với trạng thái theo kho (Chờ xử lý / Đã xử lý) và phân loại nguồn',
  })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'COMPLETED'] })
  @ApiQuery({ name: 'type', required: false, enum: ['CUSTOMER', 'TRANSFER'] })
  @ApiQuery({ name: 'fromDate', required: false, type: String })
  @ApiQuery({ name: 'toDate', required: false, type: String })
  async getInboundTrips(
    @Request() req: any,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.warehouseService.getInboundTrips(req.user, {
      search,
      status,
      type,
      fromDate,
      toDate,
      page,
      limit,
    });
  }

  @Get('trips/:tripCode/manifest')
  @Roles(
    RoleEnum.SUPER_ADMIN,
    RoleEnum.WAREHOUSE_MANAGER,
    RoleEnum.DISPATCHER,
    RoleEnum.FLEET_MANAGER,
  )
  @ApiOperation({
    summary:
      'Bảng kê toàn bộ hàng trên chuyến xe (SD...) theo góc nhìn kho: dòng nhận tại kho, số dự kiến / đã nhận, trạng thái từng trạm',
  })
  @ApiParam({ name: 'tripCode', type: String, example: 'SD12' })
  async getTripManifest(
    @Request() req: any,
    @Param('tripCode') tripCode: string,
  ) {
    return this.warehouseService.getTripManifest(req.user, tripCode);
  }

  @Post('trips/:tripCode/append-order')
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.WAREHOUSE_MANAGER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Bốc thêm đơn hàng vào chuyến xe đang chạy (bốc dọc đường hoặc xuất từ Hub)',
  })
  @ApiParam({ name: 'tripCode', type: String, example: 'SD10' })
  async appendOrderToTrip(
    @Request() req: any,
    @Param('tripCode') tripCode: string,
    @Body() dto: AppendOrderToTripDto,
  ) {
    return this.warehouseService.appendOrderToTrip(req.user, tripCode, dto);
  }

  @Get('trips/:tripCode/available-outbound-orders')
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.WAREHOUSE_MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Lấy danh sách các đơn hàng đang lưu tại kho sẵn sàng xuất lên chuyến xe',
  })
  @ApiParam({ name: 'tripCode', type: String, example: 'SD10' })
  @ApiQuery({
    name: 'hubId',
    required: false,
    type: Number,
    description: 'ID kho xuất của tài khoản đang thao tác',
  })
  async getAvailableOutboundOrders(
    @Request() req: any,
    @Param('tripCode') tripCode: string,
    @Query('hubId') hubId?: number,
  ) {
    return this.warehouseService.getAvailableOutboundOrders(
      req.user,
      tripCode,
      hubId ? Number(hubId) : undefined,
    );
  }

  @Post('trips/:tripCode/append-stored-orders')
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.WAREHOUSE_MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Bốc hàng loạt đơn hàng lưu kho sẵn có lên chuyến xe xuất kho',
  })
  @ApiParam({ name: 'tripCode', type: String, example: 'SD10' })
  async appendStoredOrdersToTrip(
    @Request() req: any,
    @Param('tripCode') tripCode: string,
    @Body() dto: AppendStoredOrdersDto,
  ) {
    return this.warehouseService.appendStoredOrdersToTrip(
      req.user,
      tripCode,
      dto,
    );
  }

  @Post('trips/:tripCode/transit-step')
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.WAREHOUSE_MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cập nhật tiến trình trạm trung chuyển (Transit Stop Lifecycle)',
  })
  @ApiParam({ name: 'tripCode', type: String, example: 'SD10' })
  async updateTransitStep(
    @Request() req: any,
    @Param('tripCode') tripCode: string,
    @Body() body: { step: 'INBOUND' | 'OUTBOUND'; action: 'CONFIRM' | 'SKIP' },
  ) {
    return this.warehouseService.updateTransitStep(req.user, tripCode, body);
  }

  @Post('inbound/quick-create')
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.WAREHOUSE_MANAGER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Tạo nhanh dòng hàng nhập kho từ khách hàng',
  })
  async quickCreateInbound(
    @Request() req: any,
    @Body() dto: QuickCreateInboundOrderDto,
  ) {
    return this.warehouseService.quickCreateInboundOrder(req.user, dto);
  }

  @Post('inbound/batch-create')
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.WAREHOUSE_MANAGER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Tạo lô hàng nhập kho từ 1 xe (nhiều dòng hàng chung 1 chuyến xe / trip)',
  })
  async batchCreateInbound(
    @Request() req: any,
    @Body() dto: BatchQuickCreateInboundDto,
  ) {
    return this.warehouseService.batchCreateInboundOrders(req.user, dto);
  }

  @Post('inbound/confirm')
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.WAREHOUSE_MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Xác nhận dỡ hàng và nhập vào kho (chuyển trạng thái LƯU KHO / INBOUND)',
  })
  async confirmInbound(@Request() req: any, @Body() body: any) {
    return this.warehouseService.confirmInbound(req.user, body);
  }

  @Post('outbound/confirm')
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.WAREHOUSE_MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Xác nhận xuất kho (Giao khách hàng hoặc Luân chuyển)',
  })
  async confirmOutbound(@Request() req: any, @Body() dto: ConfirmOutboundDto) {
    return this.warehouseService.confirmOutbound(req.user, dto);
  }

  @Post('outbound/draft')
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.WAREHOUSE_MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Lưu nháp phiếu xuất kho (chuyến SD... Chờ xử lý, chưa trừ tồn kho). Gửi draftTripCode để cập nhật nháp cũ.',
  })
  async saveOutboundDraft(
    @Request() req: any,
    @Body() dto: ConfirmOutboundDto,
  ) {
    return this.warehouseService.saveOutboundDraft(req.user, dto);
  }

  @Delete('outbound/drafts/:tripCode')
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.WAREHOUSE_MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hủy chuyến nháp xuất kho (chỉ chuyến chưa xuất)' })
  @ApiParam({ name: 'tripCode', type: String, example: 'SD32' })
  async cancelOutboundDraft(
    @Request() req: any,
    @Param('tripCode') tripCode: string,
  ) {
    return this.warehouseService.cancelOutboundDraft(req.user, tripCode);
  }
}
