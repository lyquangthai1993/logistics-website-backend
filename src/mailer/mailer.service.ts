import { Injectable, Logger } from '@nestjs/common';
import fs from 'node:fs/promises';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import Handlebars from 'handlebars';
import { Resend } from 'resend';
import { AllConfigType } from '../config/config.type';

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly transporter?: nodemailer.Transporter;
  private readonly resendClient?: Resend;

  constructor(private readonly configService: ConfigService<AllConfigType>) {
    const resendApiKey = this.configService.get('mail.resendApiKey', {
      infer: true,
    });
    if (resendApiKey) {
      this.resendClient = new Resend(resendApiKey);
      this.logger.log(
        'Resend client initialized for transactional email delivery.',
      );
    }

    const mailHost = this.configService.get('mail.host', { infer: true });
    if (mailHost) {
      this.transporter = nodemailer.createTransport({
        host: mailHost,
        port: configService.get('mail.port', { infer: true }),
        ignoreTLS: configService.get('mail.ignoreTLS', { infer: true }),
        secure: configService.get('mail.secure', { infer: true }),
        requireTLS: configService.get('mail.requireTLS', { infer: true }),
        auth:
          configService.get('mail.user', { infer: true }) &&
          configService.get('mail.password', { infer: true })
            ? {
                user: configService.get('mail.user', { infer: true }),
                pass: configService.get('mail.password', { infer: true }),
              }
            : undefined,
      });
    }
  }

  async sendMail({
    templatePath,
    context,
    ...mailOptions
  }: nodemailer.SendMailOptions & {
    templatePath?: string;
    context?: Record<string, unknown>;
  }): Promise<void> {
    let html: string | undefined;
    if (templatePath) {
      const template = await fs.readFile(templatePath, 'utf-8');
      html = Handlebars.compile(template, {
        strict: true,
      })(context || {});
    }

    // Check if simulation mode is enabled via MAIL_SIMULATE=true
    const isSimulate = this.configService.get('mail.simulate', { infer: true });
    if (isSimulate) {
      this.logger.log(
        `[MAIL SIMULATION ACTIVE] Email to "${mailOptions.to}" ("${mailOptions.subject}") rendered and simulated successfully without calling external provider.`,
      );
      return;
    }

    const defaultName =
      this.configService.get('mail.defaultName', { infer: true }) ||
      'Spider Express Logistics';
    const defaultEmail =
      this.configService.get('mail.defaultEmail', { infer: true }) ||
      'onboarding@resend.dev';
    const from = mailOptions.from
      ? (mailOptions.from as string)
      : `"${defaultName}" <${defaultEmail}>`;
    const finalHtml = (mailOptions.html as string) || html || '';
    const subject = mailOptions.subject || '';

    // 1. Gửi qua Resend API nếu có cấu hình RESEND_API_KEY
    if (this.resendClient) {
      try {
        const to = Array.isArray(mailOptions.to)
          ? (mailOptions.to as string[])
          : typeof mailOptions.to === 'string'
            ? [mailOptions.to]
            : mailOptions.to
              ? [String(mailOptions.to)]
              : [];

        const { data, error } = await this.resendClient.emails.send({
          from,
          to,
          subject,
          html: finalHtml,
          text: (mailOptions.text as string) || undefined,
        });

        if (error) {
          throw new Error(`Resend API Error: ${error.name} - ${error.message}`);
        }

        this.logger.log(
          `[Resend] Email sent successfully to ${to.join(', ')} (id: ${data?.id})`,
        );
        return;
      } catch (error) {
        const err = error as Error;
        this.logger.error(
          `Failed to send email via Resend to ${mailOptions.to}: ${err.message}`,
          err.stack,
        );
        this.handleFallbackOrThrow(error, mailOptions.to);
        return;
      }
    }

    // 2. Fallback gửi qua Nodemailer SMTP nếu có cấu hình SMTP Host
    if (this.transporter) {
      try {
        await this.transporter.sendMail({
          ...mailOptions,
          from,
          html: finalHtml,
        });
        this.logger.log(`[SMTP] Email sent successfully to ${mailOptions.to}`);
        return;
      } catch (error) {
        const err = error as Error;
        this.logger.error(
          `Failed to send email via SMTP to ${mailOptions.to}: ${err.message}`,
          err.stack,
        );
        this.handleFallbackOrThrow(error, mailOptions.to);
        return;
      }
    }

    // 3. Nếu không có Resend và không có SMTP Host
    const nodeEnv = this.configService.get('app.nodeEnv', { infer: true });
    if (nodeEnv === 'development' || !nodeEnv) {
      this.logger.warn(
        `[DEV SIMULATION] No email provider configured (missing RESEND_API_KEY or MAIL_HOST). Email to ${mailOptions.to} was rendered and processed locally.`,
      );
      return;
    }

    throw new Error(
      'No email provider configured. Please set RESEND_API_KEY or MAIL_HOST in environment variables.',
    );
  }

  private handleFallbackOrThrow(error: unknown, recipient: unknown): void {
    const nodeEnv = this.configService.get('app.nodeEnv', { infer: true });
    if (nodeEnv === 'development' || !nodeEnv) {
      this.logger.warn(
        `[DEV SIMULATION] Email to ${recipient} delivery failed, but proceeding in development mode. Configure RESEND_API_KEY or MAIL_HOST in .env.`,
      );
      return;
    }
    throw error;
  }
}
