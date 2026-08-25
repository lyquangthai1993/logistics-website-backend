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
  private readonly resend?: Resend;

  constructor(private readonly configService: ConfigService<AllConfigType>) {
    const resendApiKey = this.configService.get('mail.resendApiKey', {
      infer: true,
    });
    if (resendApiKey) {
      this.resend = new Resend(resendApiKey);
      this.logger.log(
        '🚀 [Mailer] Resend API initialized successfully (Primary Provider)',
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
      this.logger.log(
        `SMTP Transporter initialized for ${mailHost}:${configService.get('mail.port', { infer: true })}`,
      );
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
        `🧪 [Mailer] [SIMULATION ACTIVE] Rendered template in ${elapsed}ms for "${recipientStr}" ("${subject}"). Skipping external call.`,
      );
      return;
    }

    const defaultName =
      this.configService.get('mail.defaultName', { infer: true }) ||
      'Spider Express Logistics';
    const defaultEmail =
      this.configService.get('mail.defaultEmail', { infer: true }) ||
      (this.resend ? 'onboarding@resend.dev' : 'no-reply@spiderexpress.com');
    const from = mailOptions.from
      ? (mailOptions.from as string)
      : `"${defaultName}" <${defaultEmail}>`;
    const finalHtml = (mailOptions.html as string) || html || '';

    // 1. ƯU TIÊN GỬI QUA RESEND API (Nếu có RESEND_API_KEY)
    if (this.resend) {
      this.logger.log(
        `🚀 [Mailer] [RESEND API] Dispatching email via Resend API → From: "${from}" | To: "${recipientStr}" | Subject: "${subject}"`,
      );

      try {
        const recipients = Array.isArray(mailOptions.to)
          ? (mailOptions.to as string[])
          : [String(mailOptions.to)];

        const { data, error } = await this.resend.emails.send({
          from,
          to: recipients,
          subject,
          html: finalHtml,
          text: mailOptions.text as string | undefined,
        });

        if (error) {
          throw new Error(`Resend API Error: ${error.message} (${error.name})`);
        }

        const elapsed = Date.now() - startTime;
        this.logger.log(
          `✅ [Mailer] [RESEND API] SUCCESS in ${elapsed}ms | Resend ID: ${data?.id} | Delivered to "${recipientStr}"`,
        );
        return;
      } catch (resendError) {
        const elapsed = Date.now() - startTime;
        const err = resendError as Error;
        this.logger.error(
          `⚠️ [Mailer] [RESEND API] FAILED in ${elapsed}ms: ${err.message}. Checking SMTP fallback...`,
        );

        // Fallback to SMTP if available
        if (!this.transporter) {
          this.handleFallbackOrThrow(resendError, recipientStr);
          return;
        }
      }
    }

    // 2. GỬI QUA NODEMAILER SMTP (Mailjet / Custom SMTP)
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

    // Nếu không có cả Resend lẫn SMTP Host
    const nodeEnv = this.configService.get('app.nodeEnv', { infer: true });
    if (nodeEnv === 'development' || !nodeEnv) {
      const elapsed = Date.now() - startTime;
      this.logger.warn(
        `⚠️ [Mailer] [DEV SIMULATION] No active email provider configured (missing RESEND_API_KEY and MAIL_HOST). Processed in ${elapsed}ms for "${recipientStr}".`,
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
        `⚠️ [Mailer] [DEV SIMULATION] Email delivery failed for "${recipient}", proceeding gracefully without throwing in development mode. Check SMTP credentials or network settings.`,
      );
      return;
    }
    throw error;
  }
}
