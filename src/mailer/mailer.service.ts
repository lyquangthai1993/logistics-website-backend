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
    const startTime = Date.now();
    const recipientStr = Array.isArray(mailOptions.to)
      ? mailOptions.to.join(', ')
      : String(mailOptions.to ?? 'unknown');
    const subject = mailOptions.subject || '(no subject)';

    this.logger.log(
      `📧 [Mailer] START sendMail request → To: "${recipientStr}" | Subject: "${subject}"${templatePath ? ` | Template: ${templatePath.split(/[/\\]/).pop()}` : ''}`,
    );

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
      const elapsed = Date.now() - startTime;
      this.logger.log(
        `🧪 [Mailer] [SIMULATION ACTIVE] Rendered template in ${elapsed}ms for "${recipientStr}" ("${subject}"). Skipping external API call.`,
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

    // 1. Gửi qua Resend API nếu có cấu hình RESEND_API_KEY
    if (this.resendClient) {
      const to = Array.isArray(mailOptions.to)
        ? (mailOptions.to as string[])
        : typeof mailOptions.to === 'string'
          ? [mailOptions.to]
          : mailOptions.to
            ? [String(mailOptions.to)]
            : [];

      // ------------------------------------------------------------------------------------------------
      // TẠM THỜI: Hardcode 'onboarding@resend.dev' để gửi test qua Resend khi chưa verify custom domain.
      //
      // TODO: Khi đã verify domain riêng (ví dụ: spiderexpress.vn) trên dashboard https://resend.com/domains:
      //       Thay thế dòng này bằng biến cấu hình thực sự từ environment:
      //       const resendFrom = mailOptions.from
      //         ? (mailOptions.from as string)
      //         : `"${defaultName}" <${defaultEmail}>`; // e.g. "Spider Express Logistics" <no-reply@spiderexpress.vn>
      // ------------------------------------------------------------------------------------------------
      const resendFrom = 'onboarding@resend.dev';

      this.logger.log(
        `🚀 [Mailer] [Resend API] Dispatching email via HTTPS port 443 → From: "${resendFrom}" | To: [${to.join(', ')}] | Subject: "${subject}" | ContentSize: ${finalHtml.length} bytes`,
      );

      try {
        const { data, error } = await this.resendClient.emails.send({
          from: resendFrom,
          to,
          subject,
          html: finalHtml,
          text: (mailOptions.text as string) || undefined,
        });

        const elapsed = Date.now() - startTime;

        if (error) {
          throw new Error(`Resend API Error: ${error.name} - ${error.message}`);
        }

        this.logger.log(
          `✅ [Mailer] [Resend API] SUCCESS in ${elapsed}ms | MessageId: "${data?.id}" | To: [${to.join(', ')}] | From: "${resendFrom}"`,
        );
        return;
      } catch (error) {
        const elapsed = Date.now() - startTime;
        const err = error as Error;
        this.logger.error(
          `❌ [Mailer] [Resend API] FAILED in ${elapsed}ms to ${recipientStr}: ${err.message}`,
          err.stack,
        );
        this.handleFallbackOrThrow(error, recipientStr);
        return;
      }
    }

    // 2. Fallback gửi qua Nodemailer SMTP nếu có cấu hình SMTP Host
    if (this.transporter) {
      const mailHost = this.configService.get('mail.host', { infer: true });
      const mailPort = this.configService.get('mail.port', { infer: true });

      this.logger.log(
        `🚀 [Mailer] [SMTP] Dispatching email via SMTP (${mailHost}:${mailPort}) → From: "${from}" | To: "${recipientStr}" | Subject: "${subject}"`,
      );

      try {
        await this.transporter.sendMail({
          ...mailOptions,
          from,
          html: finalHtml,
        });
        const elapsed = Date.now() - startTime;
        this.logger.log(
          `✅ [Mailer] [SMTP] SUCCESS in ${elapsed}ms | Delivered to "${recipientStr}"`,
        );
        return;
      } catch (error) {
        const elapsed = Date.now() - startTime;
        const err = error as Error;
        this.logger.error(
          `❌ [Mailer] [SMTP] FAILED in ${elapsed}ms to ${recipientStr}: ${err.message}`,
          err.stack,
        );
        this.handleFallbackOrThrow(error, recipientStr);
        return;
      }
    }

    // 3. Nếu không có Resend và không có SMTP Host
    const nodeEnv = this.configService.get('app.nodeEnv', { infer: true });
    if (nodeEnv === 'development' || !nodeEnv) {
      const elapsed = Date.now() - startTime;
      this.logger.warn(
        `⚠️ [Mailer] [DEV SIMULATION] No active provider configured (missing RESEND_API_KEY or MAIL_HOST). Processed in ${elapsed}ms for "${recipientStr}".`,
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
        `⚠️ [Mailer] [DEV SIMULATION] Email delivery failed for "${recipient}", proceeding gracefully without throwing in development mode. Check RESEND_API_KEY or domain settings.`,
      );
      return;
    }
    throw error;
  }
}

