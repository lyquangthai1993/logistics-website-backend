import { Injectable, Logger } from '@nestjs/common';
import fs from 'node:fs/promises';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import Handlebars from 'handlebars';
import { AllConfigType } from '../config/config.type';

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly transporter?: nodemailer.Transporter;

  constructor(private readonly configService: ConfigService<AllConfigType>) {
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
      'no-reply@spiderexpress.com';
    const from = mailOptions.from
      ? (mailOptions.from as string)
      : `"${defaultName}" <${defaultEmail}>`;
    const finalHtml = (mailOptions.html as string) || html || '';

    // Gửi trực tiếp qua Nodemailer SMTP
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

    // Nếu không có cấu hình SMTP Host
    const nodeEnv = this.configService.get('app.nodeEnv', { infer: true });
    if (nodeEnv === 'development' || !nodeEnv) {
      const elapsed = Date.now() - startTime;
      this.logger.warn(
        `⚠️ [Mailer] [DEV SIMULATION] No active SMTP provider configured (missing MAIL_HOST). Processed in ${elapsed}ms for "${recipientStr}".`,
      );
      return;
    }

    throw new Error(
      'No email provider configured. Please set MAIL_HOST in environment variables.',
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
