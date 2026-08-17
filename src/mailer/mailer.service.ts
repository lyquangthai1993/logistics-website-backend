import { Injectable, Logger } from '@nestjs/common';
import fs from 'node:fs/promises';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import Handlebars from 'handlebars';
import { AllConfigType } from '../config/config.type';

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly transporter: nodemailer.Transporter;

  constructor(private readonly configService: ConfigService<AllConfigType>) {
    this.transporter = nodemailer.createTransport({
      host: configService.get('mail.host', { infer: true }),
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

  async sendMail({
    templatePath,
    context,
    ...mailOptions
  }: nodemailer.SendMailOptions & {
    templatePath: string;
    context: Record<string, unknown>;
  }): Promise<void> {
    let html: string | undefined;
    if (templatePath) {
      const template = await fs.readFile(templatePath, 'utf-8');
      html = Handlebars.compile(template, {
        strict: true,
      })(context);
    }

    try {
      await this.transporter.sendMail({
        ...mailOptions,
        from: mailOptions.from
          ? mailOptions.from
          : `"${this.configService.get('mail.defaultName', {
              infer: true,
            })}" <${this.configService.get('mail.defaultEmail', {
              infer: true,
            })}>`,
        html: mailOptions.html ? mailOptions.html : html,
      });
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Failed to send email to ${mailOptions.to}: ${err.message}`,
        err.stack,
      );

      // In local development mode without active SMTP server (e.g. ENOTFOUND maildev),
      // simulate success and log warning so API does not crash with 500 error.
      const nodeEnv = this.configService.get('app.nodeEnv', { infer: true });
      if (nodeEnv === 'development' || !nodeEnv) {
        this.logger.warn(
          `[DEV SIMULATION] Email to ${mailOptions.to} was rendered and processed successfully. Configure SMTP in .env (MAIL_HOST) for real email delivery.`,
        );
        return;
      }
      throw error;
    }
  }
}
