import { Test, TestingModule } from '@nestjs/testing';
import { MailerService } from './mailer.service';
import { ConfigService } from '@nestjs/config';

// Mock the Resend class
const mockResendSend = jest.fn();
jest.mock('resend', () => {
  return {
    Resend: jest.fn().mockImplementation(() => {
      return {
        emails: {
          send: mockResendSend,
        },
      };
    }),
  };
});

describe('MailerService', () => {
  let service: MailerService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('with Resend API Key configured', () => {
    beforeEach(async () => {
      mockResendSend.mockResolvedValue({
        data: { id: 'msg_12345' },
        error: null,
      });

      const mockConfigService = {
        get: jest.fn().mockImplementation((key: string) => {
          if (key === 'mail.resendApiKey') return 're_test_api_key';
          if (key === 'mail.defaultEmail') return 'onboarding@resend.dev';
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

    it('should send email via Resend successfully', async () => {
      await service.sendMail({
        to: 'recipient@example.com',
        subject: 'Test Subject',
        html: '<p>Test content</p>',
      });

      expect(mockResendSend).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'onboarding@resend.dev',
          to: ['recipient@example.com'],
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
          if (key === 'mail.resendApiKey') return 're_test_key';
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

      expect(mockResendSend).not.toHaveBeenCalled();
    });
  });
});
