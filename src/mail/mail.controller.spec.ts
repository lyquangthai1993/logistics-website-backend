import { Test, TestingModule } from '@nestjs/testing';
import { MailController } from './mail.controller';
import { MailService } from './mail.service';

describe('MailController', () => {
  let controller: MailController;
  let service: jest.Mocked<MailService>;

  beforeEach(async () => {
    const mockMailService = {
      sendGenericNotification: jest.fn().mockResolvedValue(undefined),
      getQueueStatus: jest.fn().mockResolvedValue({
        enabled: true,
        status: 'connected',
        redis: { host: 'localhost', port: 6379, ping: 'PONG' },
        queue: {
          name: 'mail',
          isPaused: false,
          waiting: 0,
          active: 0,
          completed: 5,
          failed: 0,
          delayed: 0,
        },
        timestamp: '2026-08-26T02:50:00.000Z',
      }),
      cleanQueue: jest.fn().mockResolvedValue({
        success: true,
        message:
          'Đã dọn dẹp hàng đợi BullMQ và làm sạch Redis thành công (10 -> 0 keys)',
        cleared: { beforeKeys: 10, afterKeys: 0 },
        timestamp: '2026-08-26T02:50:00.000Z',
      }),
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

  describe('testSendEmail', () => {
    it('should call mailService.sendGenericNotification and return success', async () => {
      const dto = {
        to: 'lyquangthai1993@gmail.com',
        subject: 'Tiêu đề kiểm tra',
        message: 'Nội dung kiểm tra',
      };

      const result = await controller.testSendEmail(dto);

      expect(service.sendGenericNotification).toHaveBeenCalledWith({
        to: 'lyquangthai1993@gmail.com',
        data: {
          title: 'Tiêu đề kiểm tra',
          message: 'Nội dung kiểm tra',
          actionUrl: '/dashboard',
        },
      });
      expect(result).toEqual({
        success: true,
        message: 'Đã gửi email test thành công đến lyquangthai1993@gmail.com',
      });
    });

    it('should use default subject and message if not provided in dto', async () => {
      const dto = {
        to: 'test@example.com',
      };

      const result = await controller.testSendEmail(dto);

      expect(service.sendGenericNotification).toHaveBeenCalledWith({
        to: 'test@example.com',
        data: {
          title: 'Thông báo thử nghiệm gửi email - Spider TMS',
          message:
            'Đây là email thử nghiệm được gửi từ hệ thống Spider TMS qua SMTP Relay.',
          actionUrl: '/dashboard',
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('getQueueStatus', () => {
    it('should return queue status from mailService.getQueueStatus', async () => {
      const result = await controller.getQueueStatus();

      expect(service.getQueueStatus).toHaveBeenCalled();
      expect(result.status).toBe('connected');
      expect(result.queue?.name).toBe('mail');
    });
  });

  describe('cleanQueue', () => {
    it('should call mailService.cleanQueue and return result', async () => {
      const result = await controller.cleanQueue();

      expect(service.cleanQueue).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.cleared.beforeKeys).toBe(10);
      expect(result.cleared.afterKeys).toBe(0);
    });
  });
});
