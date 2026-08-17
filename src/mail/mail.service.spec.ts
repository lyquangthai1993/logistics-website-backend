import { Test, TestingModule } from '@nestjs/testing';
import { MailService } from './mail.service';
import { MailerService } from '../mailer/mailer.service';
import { ConfigService } from '@nestjs/config';
import {
  DispatcherNotificationType,
  FleetNotificationType,
  WarehouseNotificationType,
} from './interfaces/logistics-mail-data.interface';

describe('MailService', () => {
  let service: MailService;
  let mailerService: jest.Mocked<MailerService>;

  beforeEach(async () => {
    const mockMailerService = {
      sendMail: jest.fn().mockResolvedValue(undefined),
    };

    const mockConfigService = {
      getOrThrow: jest.fn().mockImplementation((key: string) => {
        if (key === 'app.workingDirectory') return process.cwd();
        if (key === 'app.frontendDomain') return 'https://tms.spiderexpress.vn';
        return '';
      }),
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'app.name') return 'Spider Express Logistics';
        return '';
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        {
          provide: MailerService,
          useValue: mockMailerService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<MailService>(MailService);
    mailerService = module.get(MailerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendWarehouseNotification', () => {
    it('should call mailerService.sendMail with warehouse notification template', async () => {
      await service.sendWarehouseNotification({
        to: 'lyquangthai1993+832@gmail.com',
        data: {
          title: 'Xác nhận Inbound Kho Andromeda',
          hubName: 'Kho Andromeda',
          notificationType: WarehouseNotificationType.INBOUND,
          tripCode: 'TRIP-2607-001',
        },
      });

      expect(mailerService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'lyquangthai1993+832@gmail.com',
          subject: 'Xác nhận Inbound Kho Andromeda',
          templatePath: expect.stringContaining('warehouse-notification.hbs'),
        }),
      );
    });
  });

  describe('sendFleetNotification', () => {
    it('should call mailerService.sendMail with fleet notification template', async () => {
      await service.sendFleetNotification({
        to: 'lyquangthai1993+419@gmail.com',
        data: {
          title: 'Cảnh báo vượt tải trọng 75H-011.37',
          notificationType: FleetNotificationType.OVERLOAD_ALERT,
          tripCode: 'TRIP-2607-002',
          vehiclePlate: '75H-011.37',
          driverName: 'Trần Văn Lái',
          route: 'Huế -> Đà Nẵng',
        },
      });

      expect(mailerService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'lyquangthai1993+419@gmail.com',
          subject: 'Cảnh báo vượt tải trọng 75H-011.37',
          templatePath: expect.stringContaining('fleet-notification.hbs'),
        }),
      );
    });
  });

  describe('sendDispatcherNotification', () => {
    it('should call mailerService.sendMail with dispatcher notification template', async () => {
      await service.sendDispatcherNotification({
        to: 'lyquangthai1993+756@gmail.com',
        data: {
          title: 'Tiếp nhận đơn hàng mới NDA2607-8892',
          notificationType: DispatcherNotificationType.NEW_ORDER,
          orderCode: 'NDA2607-8892',
        },
      });

      expect(mailerService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'lyquangthai1993+756@gmail.com',
          subject: 'Tiếp nhận đơn hàng mới NDA2607-8892',
          templatePath: expect.stringContaining('dispatcher-notification.hbs'),
        }),
      );
    });
  });

  describe('sendGenericNotification', () => {
    it('should call mailerService.sendMail with generic notification template', async () => {
      await service.sendGenericNotification({
        to: 'lyquangthai1993+204@gmail.com',
        data: {
          title: 'Thông báo hệ thống TMS',
          message: 'Nội dung thông báo tùy chỉnh',
        },
      });

      expect(mailerService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'lyquangthai1993+204@gmail.com',
          subject: 'Thông báo hệ thống TMS',
          templatePath: expect.stringContaining('generic-notification.hbs'),
        }),
      );
    });
  });
});
