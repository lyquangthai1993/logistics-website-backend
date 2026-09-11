import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../roles/roles.guard';
import { Roles } from '../roles/roles.decorator';
import { RoleEnum } from '../roles/roles.enum';
import { WarehouseService } from './warehouse.service';
import { QuickCreateInboundOrderDto } from './dto/quick-create-inbound-order.dto';
import { ConfirmOutboundDto } from './dto/confirm-outbound.dto';

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
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.WAREHOUSE_MANAGER, RoleEnum.DISPATCHER, RoleEnum.FLEET_MANAGER)
  @ApiOperation({
    summary: 'Tra cứu & danh sách hàng hóa trong kho (Freetext + Status + Pagination)',
  })
  async getOrders(
    @Request() req: any,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.warehouseService.getOrders(req.user, {
      search,
      status,
      page,
      limit,
    });
  }

  @Get('kpi')
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.WAREHOUSE_MANAGER)
  @ApiOperation({
    summary: 'Lấy chỉ số KPI tổng quan kho (Chờ nhập, Lưu kho, Chờ xuất, Đã xuất)',
  })
  async getKpi(@Request() req: any) {
    return this.warehouseService.getKpiStats(req.user);
  }

  @Get('inbound-trips')
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.WAREHOUSE_MANAGER)
  @ApiOperation({
    summary: 'Danh sách chuyến xe luân chuyển đang đến kho (còn hàng cần dỡ)',
  })
  async getInboundTrips(
    @Request() req: any,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.warehouseService.getInboundTrips(req.user, {
      search,
      page,
      limit,
    });
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

  @Post('inbound/confirm')
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.WAREHOUSE_MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Xác nhận dỡ hàng và nhập vào kho (chuyển trạng thái LƯU KHO / INBOUND)',
  })
  async confirmInbound(
    @Request() req: any,
    @Body('orderIds') orderIds: number[],
  ) {
    return this.warehouseService.confirmInbound(req.user, orderIds);
  }

  @Post('outbound/confirm')
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.WAREHOUSE_MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Xác nhận xuất kho (Giao khách hàng hoặc Luân chuyển)',
  })
  async confirmOutbound(
    @Request() req: any,
    @Body() dto: ConfirmOutboundDto,
  ) {
    return this.warehouseService.confirmOutbound(req.user, dto);
  }
}
