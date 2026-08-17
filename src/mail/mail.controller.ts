import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { MailService } from './mail.service';
import { SendWarehouseNotificationDto } from './dto/send-warehouse-notification.dto';
import { SendFleetNotificationDto } from './dto/send-fleet-notification.dto';
import { SendDispatcherNotificationDto } from './dto/send-dispatcher-notification.dto';
import { SendGenericNotificationDto } from './dto/send-generic-notification.dto';
import {
  DispatcherNotificationType,
  FleetNotificationType,
  WarehouseNotificationType,
} from './interfaces/logistics-mail-data.interface';

@ApiTags('Mail')
@Controller({
  path: 'mail',
  version: '1',
})
export class MailController {
  constructor(private readonly mailService: MailService) {}

  @Post('send-warehouse')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Gửi email thông báo nghiệp vụ Kho (Warehouse Manager)',
  })
  @ApiResponse({
    status: 200,
    description: 'Email thông báo kho đã được gửi thành công',
  })
  async sendWarehouseNotification(
    @Body() dto: SendWarehouseNotificationDto,
  ): Promise<{ success: boolean; message: string }> {
    const { to, ...data } = dto;
    await this.mailService.sendWarehouseNotification({ to, data });
    return {
      success: true,
      message: `Đã gửi thông báo kho thành công đến ${to}`,
    };
  }

  @Post('send-fleet')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Gửi email thông báo nghiệp vụ Đội xe (Fleet Manager / Driver)',
  })
  @ApiResponse({
    status: 200,
    description: 'Email thông báo đội xe đã được gửi thành công',
  })
  async sendFleetNotification(
    @Body() dto: SendFleetNotificationDto,
  ): Promise<{ success: boolean; message: string }> {
    const { to, ...data } = dto;
    await this.mailService.sendFleetNotification({ to, data });
    return {
      success: true,
      message: `Đã gửi thông báo đội xe thành công đến ${to}`,
    };
  }

  @Post('send-dispatcher')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Gửi email thông báo nghiệp vụ Điều hành (Dispatcher / Super Admin)',
  })
  @ApiResponse({
    status: 200,
    description: 'Email thông báo điều hành đã được gửi thành công',
  })
  async sendDispatcherNotification(
    @Body() dto: SendDispatcherNotificationDto,
  ): Promise<{ success: boolean; message: string }> {
    const { to, ...data } = dto;
    await this.mailService.sendDispatcherNotification({ to, data });
    return {
      success: true,
      message: `Đã gửi thông báo điều hành thành công đến ${to}`,
    };
  }

  @Post('send-generic')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Gửi email thông báo linh hoạt (Custom Notification)',
  })
  @ApiResponse({
    status: 200,
    description: 'Email thông báo linh hoạt đã được gửi thành công',
  })
  async sendGenericNotification(
    @Body() dto: SendGenericNotificationDto,
  ): Promise<{ success: boolean; message: string }> {
    const { to, ...data } = dto;
    await this.mailService.sendGenericNotification({ to, data });
    return {
      success: true,
      message: `Đã gửi thông báo linh hoạt thành công đến ${to}`,
    };
  }

  @Post('test-warehouse')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Test gửi email thông báo Kho mẫu (Andromeda Inbound 17H)',
  })
  async testWarehouseNotification(
    @Body('email') email?: string,
  ): Promise<{ success: boolean; message: string }> {
    const targetEmail = email || 'lyquangthai1993+101@gmail.com';
    await this.mailService.sendWarehouseNotification({
      to: targetEmail,
      data: {
        title: 'Xác nhận Inbound xe gom hàng về Kho Andromeda trước 17H',
        recipientName: 'Quản lý Kho Andromeda',
        hubName: 'Kho Andromeda (Linh Trung, Thủ Đức, HCM)',
        notificationType: WarehouseNotificationType.INBOUND,
        tripCode: 'TRIP-2607-001',
        vehiclePlate: '75H-041.73',
        driverName: 'Lê Văn Tài',
        expectedTime: '16:45 - 17/08/2026',
        totalPackages: 120,
        totalWeight: '2,400 kg',
        totalVolume: '14.5 m³',
        notes:
          'Hàng gom Miền Bắc cần ưu tiên kiểm đếm phân loại trước mốc chốt hàng 17H00.',
        actionUrl:
          'https://tms.spiderexpress.vn/warehouse/inbound/TRIP-2607-001',
      },
    });
    return {
      success: true,
      message: `Đã gửi email test thông báo kho thành công đến ${targetEmail}`,
    };
  }

  @Post('test-fleet')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Test gửi email thông báo Đội xe mẫu (Cảnh báo vượt tải 75H-011.37)',
  })
  async testFleetNotification(
    @Body('email') email?: string,
  ): Promise<{ success: boolean; message: string }> {
    const targetEmail = email || 'lyquangthai1993+202@gmail.com';
    await this.mailService.sendFleetNotification({
      to: targetEmail,
      data: {
        title: 'Cảnh báo vượt tải trọng chuyến xe TRIP-2607-002',
        recipientName: 'Quản lý Đội Xe (Spider Express)',
        notificationType: FleetNotificationType.OVERLOAD_ALERT,
        tripCode: 'TRIP-2607-002',
        vehiclePlate: '75H-011.37',
        driverName: 'Trần Văn Lái',
        route: 'TP. Huế -> Kho Magellan (Cẩm Lệ, Đà Nẵng)',
        currentWeight: '8,500 kg',
        maxPayload: '8,000 kg',
        currentVolume: '42.5 m³',
        maxVolume: '40.0 m³',
        status: 'OVERLOAD',
        notes:
          'Chuyến xe đang vượt quá 500kg tải trọng tối đa. Yêu cầu Quản lý xe điều chỉnh giảm bớt 1 đơn gom trước khi duyệt xuất bến.',
        actionUrl: 'https://tms.spiderexpress.vn/fleet/trips/TRIP-2607-002',
      },
    });
    return {
      success: true,
      message: `Đã gửi email test thông báo đội xe thành công đến ${targetEmail}`,
    };
  }

  @Post('test-dispatcher')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Test gửi email thông báo Điều hành mẫu (Đơn hàng NDA2607-8892)',
  })
  async testDispatcherNotification(
    @Body('email') email?: string,
  ): Promise<{ success: boolean; message: string }> {
    const targetEmail = email || 'lyquangthai1993+303@gmail.com';
    await this.mailService.sendDispatcherNotification({
      to: targetEmail,
      data: {
        title: 'Tiếp nhận đơn hàng mới NDA2607-8892 (Tuyến Miền Bắc)',
        recipientName: 'Đức Anh (Dispatcher)',
        notificationType: DispatcherNotificationType.NEW_ORDER,
        orderCode: 'NDA2607-8892',
        customerName: 'Công ty Cổ phần Bột Giặt LIX',
        pickupLocation: 'Cảng TBS Tân Vạn',
        dropoffLocation: 'Kho Vela (Phùng Chí Kiên, Mỹ Hào, Hưng Yên)',
        regionGroup: '12 ĐƠN MIỀN BẮC',
        cargoInfo: '120 thùng hóa chất gia dụng, 1,800 kg, 9.2 m³',
        status: 'PENDING_DISPATCH',
        notes:
          'Đơn hàng gấp cần gom chuyến lên kho Vela Hưng Yên trước deadline đóng hàng 17H00.',
        actionUrl: 'https://tms.spiderexpress.vn/orders/NDA2607-8892',
      },
    });
    return {
      success: true,
      message: `Đã gửi email test thông báo điều hành thành công đến ${targetEmail}`,
    };
  }
}
