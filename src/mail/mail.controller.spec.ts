import { Test, TestingModule } from '@nestjs/testing';
import { MailController } from './mail.controller';
import { MailService } from './mail.service';
import {
  DispatcherNotificationType,
  FleetNotificationType,
  WarehouseNotificationType,
} from './interfaces/logistics-mail-data.interface';

describe('MailController', () => {
  let controller: MailController;
  let service: jest.Mocked<MailService>;

  beforeEach(async () => {
    const mockMailService = {
      sendWarehouseNotification: jest.fn().mockResolvedValue(undefined),
      sendFleetNotification: jest.fn().mockResolvedValue(undefined),
      sendDispatcherNotification: jest.fn().mockResolvedValue(undefined),
      sendGenericNotification: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MailController],
      providers: [
        {
          provide: MailService,
          useValue: mockMailService,
        },
      ],
    }).compile();

    controller = module.get<MailController>(MailController);
    service = module.get(MailService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('sendWarehouseNotification', () => {
    it('should call mailService.sendWarehouseNotification and return success', async () => {
      const dto = {
        to: 'lyquangthai1993+832@gmail.com',
        title: 'Xác nhận Inbound',
        hubName: 'Kho Andromeda',
        notificationType: WarehouseNotificationType.INBOUND,
      };

      const result = await controller.sendWarehouseNotification(dto);

      expect(service.sendWarehouseNotification).toHaveBeenCalledWith({
        to: dto.to,
        data: {
          title: dto.title,
          hubName: dto.hubName,
          notificationType: dto.notificationType,
        },
      });
      expect(result).toEqual({
        success: true,
        message: `Đã gửi thông báo kho thành công đến ${dto.to}`,
      });
    });
  });

  describe('sendFleetNotification', () => {
    it('should call mailService.sendFleetNotification and return success', async () => {
      const dto = {
        to: 'lyquangthai1993+419@gmail.com',
        title: 'Cảnh báo quá tải',
        notificationType: FleetNotificationType.OVERLOAD_ALERT,
        tripCode: 'TRIP-2607-002',
        vehiclePlate: '75H-011.37',
        driverName: 'Trần Văn Lái',
        route: 'Huế -> Đà Nẵng',
      };

      const result = await controller.sendFleetNotification(dto);

      expect(service.sendFleetNotification).toHaveBeenCalledWith({
        to: dto.to,
        data: {
          title: dto.title,
          notificationType: dto.notificationType,
          tripCode: dto.tripCode,
          vehiclePlate: dto.vehiclePlate,
          driverName: dto.driverName,
          route: dto.route,
        },
      });
      expect(result).toEqual({
        success: true,
        message: `Đã gửi thông báo đội xe thành công đến ${dto.to}`,
      });
    });
  });

  describe('sendDispatcherNotification', () => {
    it('should call mailService.sendDispatcherNotification and return success', async () => {
      const dto = {
        to: 'lyquangthai1993+756@gmail.com',
        title: 'Đơn hàng mới',
        notificationType: DispatcherNotificationType.NEW_ORDER,
        orderCode: 'NDA2607-8892',
      };

      const result = await controller.sendDispatcherNotification(dto);

      expect(service.sendDispatcherNotification).toHaveBeenCalledWith({
        to: dto.to,
        data: {
          title: dto.title,
          notificationType: dto.notificationType,
          orderCode: dto.orderCode,
        },
      });
      expect(result).toEqual({
        success: true,
        message: `Đã gửi thông báo điều hành thành công đến ${dto.to}`,
      });
    });
  });

  describe('sendGenericNotification', () => {
    it('should call mailService.sendGenericNotification and return success', async () => {
      const dto = {
        to: 'lyquangthai1993+204@gmail.com',
        title: 'Thông báo chung',
        message: 'Nội dung thông báo',
      };

      const result = await controller.sendGenericNotification(dto);

      expect(service.sendGenericNotification).toHaveBeenCalledWith({
        to: dto.to,
        data: {
          title: dto.title,
          message: dto.message,
        },
      });
      expect(result).toEqual({
        success: true,
        message: `Đã gửi thông báo linh hoạt thành công đến ${dto.to}`,
      });
    });
  });

  describe('testWarehouseNotification', () => {
    it('should send warehouse test email to provided email or default email', async () => {
      const result = await controller.testWarehouseNotification();

      expect(service.sendWarehouseNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'lyquangthai1993+101@gmail.com',
        }),
      );
      expect(result.success).toBe(true);
    });
  });

  describe('testFleetNotification', () => {
    it('should send fleet test email to provided email or default email', async () => {
      const result = await controller.testFleetNotification();

      expect(service.sendFleetNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'lyquangthai1993+202@gmail.com',
        }),
      );
      expect(result.success).toBe(true);
    });
  });

  describe('testDispatcherNotification', () => {
    it('should send dispatcher test email to provided email or default email', async () => {
      const result = await controller.testDispatcherNotification();

      expect(service.sendDispatcherNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'lyquangthai1993+303@gmail.com',
        }),
      );
      expect(result.success).toBe(true);
    });
  });
});
