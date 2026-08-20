import { Test, TestingModule } from '@nestjs/testing';
import { MailController } from './mail.controller';
import { MailService } from './mail.service';

describe('MailController', () => {
  let controller: MailController;
  let service: jest.Mocked<MailService>;

  beforeEach(async () => {
    const mockMailService = {
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
            'Đây là email thử nghiệm được gửi từ hệ thống Spider TMS qua Resend API.',
          actionUrl: '/dashboard',
        },
      });
      expect(result.success).toBe(true);
    });
  });
});
