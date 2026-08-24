import { Test, TestingModule } from '@nestjs/testing';
import { MailerService } from './mailer.service';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';

// Mock nodemailer
const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: (...args: unknown[]) => mockSendMail(...args),
  }),
}));

describe('MailerService', () => {
  let service: MailerService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('with SMTP configured', () => {
    beforeEach(async () => {
      mockSendMail.mockResolvedValue({ messageId: 'msg_12345' });

      const mockConfigService = {
        get: jest.fn().mockImplementation((key: string) => {
          if (key === 'mail.host') return 'in-v3.mailjet.com';
          if (key === 'mail.port') return 587;
          if (key === 'mail.user') return 'test_user';
          if (key === 'mail.password') return 'test_pass';
          if (key === 'mail.defaultEmail') return 'no-reply@spiderexpress.com';
          if (key === 'mail.defaultName') return 'Spider TMS';
          if (key === 'mail.simulate') return false;
          if (key === 'app.nodeEnv') return 'development';
          return undefined;
        }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MailerService,
          {
            provide: ConfigService,
            useValue: mockConfigService,
          },
        ],
      }).compile();

      service = module.get<MailerService>(MailerService);
    });

    it('should send email via SMTP successfully', async () => {
      await service.sendMail({
        to: 'recipient@example.com',
        subject: 'Test Subject',
        html: '<p>Test content</p>',
      });

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: '"Spider TMS" <no-reply@spiderexpress.com>',
          to: 'recipient@example.com',
          subject: 'Test Subject',
          html: '<p>Test content</p>',
        }),
      );
    });
  });

  describe('with MAIL_SIMULATE enabled', () => {
    beforeEach(async () => {
      const mockConfigService = {
        get: jest.fn().mockImplementation((key: string) => {
          if (key === 'mail.simulate') return true;
          if (key === 'mail.host') return 'in-v3.mailjet.com';
          return undefined;
        }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MailerService,
          {
            provide: ConfigService,
            useValue: mockConfigService,
          },
        ],
      }).compile();

      service = module.get<MailerService>(MailerService);
    });

    it('should skip sending and return immediately when simulate is true', async () => {
      await service.sendMail({
        to: 'recipient@example.com',
        subject: 'Simulated Email',
        html: '<p>Simulated</p>',
      });

      expect(mockSendMail).not.toHaveBeenCalled();
    });
  });
});
