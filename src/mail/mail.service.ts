import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { I18nContext } from 'nestjs-i18n';
import { MailData } from './interfaces/mail-data.interface';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import { MaybeType } from '../utils/types/maybe.type';
import { MailerService } from '../mailer/mailer.service';
import path from 'path';
import fs from 'fs';
import { AllConfigType } from '../config/config.type';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService<AllConfigType>,
    private readonly notificationsService: NotificationsService,
    @Optional() @InjectQueue('mail') private readonly mailQueue?: Queue,
  ) {}

  /**
   * Helper method to resolve email template path reliably across
   * development (ts-node / src), compiled production (dist / node), and Docker environments.
   */
  private getTemplatePath(fileName: string): string {
    const workingDir =
      this.configService.get('app.workingDirectory', { infer: true }) ||
      process.cwd();

    const candidates = [
      // 1. Next to current compiled/source directory (__dirname/mail-templates/...)
      path.join(__dirname, 'mail-templates', fileName),
      // 2. In dist relative to workingDirectory
      path.join(workingDir, 'dist', 'mail', 'mail-templates', fileName),
      // 3. In dist relative to process.cwd()
      path.join(process.cwd(), 'dist', 'mail', 'mail-templates', fileName),
      // 4. In src relative to workingDirectory
      path.join(workingDir, 'src', 'mail', 'mail-templates', fileName),
      // 5. In src relative to process.cwd()
      path.join(process.cwd(), 'src', 'mail', 'mail-templates', fileName),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    // Default fallback to candidate 1 if not found on disk
    return candidates[0];
  }

  async userSignUp(mailData: MailData<{ hash: string }>): Promise<void> {
    const i18n = I18nContext.current();
    let emailConfirmTitle: MaybeType<string>;
    let text1: MaybeType<string>;
    let text2: MaybeType<string>;
    let text3: MaybeType<string>;

    if (i18n) {
      [emailConfirmTitle, text1, text2, text3] = await Promise.all([
        i18n.t('common.confirmEmail'),
        i18n.t('confirm-email.text1'),
        i18n.t('confirm-email.text2'),
        i18n.t('confirm-email.text3'),
      ]);
    }

    const url = new URL(
      this.configService.getOrThrow('app.frontendDomain', {
        infer: true,
      }) + '/confirm-email',
    );
    url.searchParams.set('hash', mailData.data.hash);

    await this.mailerService.sendMail({
      to: mailData.to,
      subject: emailConfirmTitle,
      text: `${url.toString()} ${emailConfirmTitle}`,
      templatePath: this.getTemplatePath('activation.hbs'),
      context: {
        title: emailConfirmTitle,
        url: url.toString(),
        actionTitle: emailConfirmTitle,
        app_name: this.configService.get('app.name', { infer: true }),
        text1,
        text2,
        text3,
      },
    });
  }

  async forgotPassword(
    mailData: MailData<{ hash: string; tokenExpires: number }>,
  ): Promise<void> {
    const url = new URL(
      this.configService.getOrThrow('app.frontendDomain', {
        infer: true,
      }) + '/auth/reset-password',
    );
    url.searchParams.set('hash', mailData.data.hash);
    url.searchParams.set('expires', mailData.data.tokenExpires.toString());

    const appName = 'SPIDER EXPRESS LOGISTICS TMS';
    const emailSubject =
      '[Spider Express TMS] Khôi phục mật khẩu tài khoản / Reset Password';

    const mailPayload = {
      to: mailData.to,
      subject: emailSubject,
      text: `${emailSubject} - ${url.toString()}`,
      templatePath: this.getTemplatePath('reset-password.hbs'),
      context: {
        title: emailSubject,
        url: url.toString(),
        actionTitle: 'ĐẶT LẠI MẬT KHẨU NGAY',
        app_name: appName,
        userEmail: mailData.to,
        expiresInMinutes: 15,
        supportHotline: '1900-SPIDER',
        supportEmail: 'it-support@spiderexpress.vn',
      },
    };

    if (this.mailQueue) {
      try {
        await this.mailQueue.add('forgot-password', mailPayload, {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 100,
          removeOnFail: 50,
        });
        this.logger.log(
          `📥 [MailQueue] Enqueued forgot-password email to "${mailData.to}" via BullMQ`,
        );
        return;
      } catch (queueErr) {
        this.logger.warn(
          `⚠️ [MailQueue] Could not enqueue to Redis (${queueErr.message}). Falling back to direct SMTP.`,
        );
      }
    }

    await this.mailerService.sendMail(mailPayload);
  }

  async confirmNewEmail(mailData: MailData<{ hash: string }>): Promise<void> {
    const i18n = I18nContext.current();
    let emailConfirmTitle: MaybeType<string>;
    let text1: MaybeType<string>;
    let text2: MaybeType<string>;
    let text3: MaybeType<string>;

    if (i18n) {
      [emailConfirmTitle, text1, text2, text3] = await Promise.all([
        i18n.t('common.confirmEmail'),
        i18n.t('confirm-new-email.text1'),
        i18n.t('confirm-new-email.text2'),
        i18n.t('confirm-new-email.text3'),
      ]);
    }

    const url = new URL(
      this.configService.getOrThrow('app.frontendDomain', {
        infer: true,
      }) + '/confirm-new-email',
    );
    url.searchParams.set('hash', mailData.data.hash);

    await this.mailerService.sendMail({
      to: mailData.to,
      subject: emailConfirmTitle,
      text: `${url.toString()} ${emailConfirmTitle}`,
      templatePath: this.getTemplatePath('confirm-new-email.hbs'),
      context: {
        title: emailConfirmTitle,
        url: url.toString(),
        actionTitle: emailConfirmTitle,
        app_name: this.configService.get('app.name', { infer: true }),
        text1,
        text2,
        text3,
      },
    });
  }

  private formatActionUrl(actionUrl?: string): string | undefined {
    if (!actionUrl) return undefined;
    if (actionUrl.startsWith('http://') || actionUrl.startsWith('https://')) {
      return actionUrl;
    }
    const frontendDomain =
      this.configService.get('app.frontendDomain', { infer: true }) ||
      'http://localhost:3000';
    const cleanDomain = frontendDomain.replace(/\/+$/, '');
    const cleanPath = actionUrl.startsWith('/') ? actionUrl : `/${actionUrl}`;
    return `${cleanDomain}${cleanPath}`;
  }

  async sendWarehouseNotification(
    mailData: MailData<
      import('./interfaces/logistics-mail-data.interface').WarehouseNotificationData
    > & { userId?: number },
  ): Promise<void> {
    const templatePath = this.getTemplatePath('warehouse-notification.hbs');

    // Chạy song song: email + in-app notification (fire-and-forget, không transaction)
    await Promise.all([
      this.mailerService.sendMail({
        to: mailData.to,
        subject: mailData.data.title,
        text: `${mailData.data.title} - Hub: ${mailData.data.hubName}`,
        templatePath,
        context: {
          ...mailData.data,
          actionUrl: this.formatActionUrl(mailData.data.actionUrl),
          app_name: this.configService.get('app.name', { infer: true }),
        },
      }),
      mailData.userId
        ? this.notificationsService.create({
            userId: mailData.userId,
            title: mailData.data.title,
            body: `Hub: ${mailData.data.hubName}`,
            type: 'WAREHOUSE',
          })
        : Promise.resolve(),
    ]);
  }

  async sendFleetNotification(
    mailData: MailData<
      import('./interfaces/logistics-mail-data.interface').FleetNotificationData
    > & { userId?: number },
  ): Promise<void> {
    const templatePath = this.getTemplatePath('fleet-notification.hbs');

    // Chạy song song: email + in-app notification (fire-and-forget, không transaction)
    await Promise.all([
      this.mailerService.sendMail({
        to: mailData.to,
        subject: mailData.data.title,
        text: `${mailData.data.title} - Xe: ${mailData.data.vehiclePlate} (${mailData.data.tripCode})`,
        templatePath,
        context: {
          ...mailData.data,
          actionUrl: this.formatActionUrl(mailData.data.actionUrl),
          app_name: this.configService.get('app.name', { infer: true }),
        },
      }),
      mailData.userId
        ? this.notificationsService.create({
            userId: mailData.userId,
            title: mailData.data.title,
            body: `Xe: ${mailData.data.vehiclePlate} - Chuyến: ${mailData.data.tripCode}`,
            type: 'FLEET',
          })
        : Promise.resolve(),
    ]);
  }

  async sendDispatcherNotification(
    mailData: MailData<
      import('./interfaces/logistics-mail-data.interface').DispatcherNotificationData
    > & { userId?: number },
  ): Promise<void> {
    const templatePath = this.getTemplatePath('dispatcher-notification.hbs');

    // Chạy song song: email + in-app notification (fire-and-forget, không transaction)
    await Promise.all([
      this.mailerService.sendMail({
        to: mailData.to,
        subject: mailData.data.title,
        text: `${mailData.data.title} - Mã đơn: ${mailData.data.orderCode}`,
        templatePath,
        context: {
          ...mailData.data,
          actionUrl: this.formatActionUrl(mailData.data.actionUrl),
          app_name: this.configService.get('app.name', { infer: true }),
        },
      }),
      mailData.userId
        ? this.notificationsService.create({
            userId: mailData.userId,
            title: mailData.data.title,
            body: `Mã đơn: ${mailData.data.orderCode}`,
            type: 'DISPATCHER',
          })
        : Promise.resolve(),
    ]);
  }

  async sendGenericNotification(
    mailData: MailData<
      import('./interfaces/logistics-mail-data.interface').GenericNotificationData
    >,
  ): Promise<void> {
    const templatePath = this.getTemplatePath('generic-notification.hbs');

    await this.mailerService.sendMail({
      to: mailData.to,
      subject: mailData.data.title,
      text: `${mailData.data.title}: ${mailData.data.message}`,
      templatePath,
      context: {
        ...mailData.data,
        actionUrl: this.formatActionUrl(mailData.data.actionUrl),
        app_name: this.configService.get('app.name', { infer: true }),
      },
    });
  }

  async sendTripConfirmedNotification(
    mailData: MailData<
      import('./interfaces/logistics-mail-data.interface').TripConfirmedNotificationData
    >,
  ): Promise<void> {
    const templatePath = this.getTemplatePath('trip-confirmed.hbs');

    const subject = mailData.data.isExternal
      ? `🚨 [XE THUÊ NGOÀI] Xác nhận chuyến xe cho đơn hàng ${mailData.data.orderCode}`
      : `🚚 [Điều vận] Xác nhận chuyến xe cho đơn hàng ${mailData.data.orderCode}`;

    await this.mailerService.sendMail({
      to: mailData.to,
      subject,
      text: `${subject} - Biển số: ${mailData.data.licensePlate}`,
      templatePath,
      context: {
        ...mailData.data,
        actionUrl: this.formatActionUrl(mailData.data.actionUrl),
        app_name: this.configService.get('app.name', { infer: true }),
      },
    });
  }

  /**
   * Gửi email thông báo cho Fleet Manager / Super Admin khi có đơn hàng mới
   * chuyển sang trạng thái PENDING_FLEET (Dispatcher vừa submit).
   * Chỉ gửi email — in-app notification được tạo riêng bởi OrdersService.
   */
  async sendOrderPendingFleetNotification(
    mailData: MailData<
      import('./interfaces/logistics-mail-data.interface').OrderPendingFleetNotificationData
    >,
  ): Promise<void> {
    const templatePath = this.getTemplatePath('order-pending-fleet.hbs');

    const subject = mailData.data.isExternalVehicleNeeded
      ? `🚨 [XE NGOÀI] Đơn hàng ${mailData.data.orderCode} cần phân công xe thuê ngoài`
      : `📦 [Điều vận] Đơn hàng ${mailData.data.orderCode} cần phân công xe`;

    await this.mailerService.sendMail({
      to: mailData.to,
      subject,
      text: `${subject} - Tuyến: ${mailData.data.route} | KL: ${mailData.data.totalWeight} kg | ${mailData.data.totalVolume} m³`,
      templatePath,
      context: {
        ...mailData.data,
        actionUrl: this.formatActionUrl(mailData.data.actionUrl),
        title: subject,
        app_name: this.configService.get('app.name', { infer: true }),
      },
    });
  }

  /**
   * Gửi email thông báo cho Dispatcher & Super Admin khi Đội xe báo hết xe
   * (order chuyển sang trạng thái NO_VEHICLE).
   */
  async sendOrderNoVehicleNotification(
    mailData: MailData<
      import('./interfaces/logistics-mail-data.interface').OrderNoVehicleNotificationData
    >,
  ): Promise<void> {
    const templatePath = this.getTemplatePath('order-no-vehicle.hbs');

    const subject = `⚠️ [HẾT XE] Đơn hàng ${mailData.data.orderCode} - Đội xe báo không có xe nội bộ`;

    await this.mailerService.sendMail({
      to: mailData.to,
      subject,
      text: `${subject} - Lý do: ${mailData.data.reason} | Tuyến: ${mailData.data.route}`,
      templatePath,
      context: {
        ...mailData.data,
        actionUrl: this.formatActionUrl(mailData.data.actionUrl),
        title: subject,
        app_name: this.configService.get('app.name', { infer: true }),
      },
    });
  }

  /**
   * Lấy thông tin trạng thái kết nối Redis và thống kê hàng đợi BullMQ
   */
  async getQueueStatus() {
    const isRedisEnabled =
      this.configService.get('redis.enabled', { infer: true }) ?? false;
    const redisHost = this.configService.get('redis.host', { infer: true });
    const redisPort = this.configService.get('redis.port', { infer: true });

    if (!this.mailQueue) {
      return {
        enabled: isRedisEnabled,
        status: 'disabled',
        message: 'Mail queue is not initialized or Redis is disabled.',
        redis: {
          host: redisHost,
          port: redisPort,
        },
        queue: null,
        timestamp: new Date().toISOString(),
      };
    }

    try {
      const isPaused = await this.mailQueue.isPaused();
      const waiting = await this.mailQueue.getWaitingCount();
      const active = await this.mailQueue.getActiveCount();
      const completed = await this.mailQueue.getCompletedCount();
      const failed = await this.mailQueue.getFailedCount();
      const delayed = await this.mailQueue.getDelayedCount();

      return {
        enabled: true,
        status: 'connected',
        redis: {
          host: redisHost,
          port: redisPort,
          ping: 'PONG',
        },
        queue: {
          name: 'mail',
          isPaused,
          waiting,
          active,
          completed,
          failed,
          delayed,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        enabled: isRedisEnabled,
        status: 'error',
        message: (error as Error).message,
        redis: {
          host: redisHost,
          port: redisPort,
        },
        memory: null,
        queue: null,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Dọn sạch toàn bộ jobs trong hàng đợi BullMQ và giải phóng các keys Redis
   */
  async cleanQueue(): Promise<{
    success: boolean;
    message: string;
    cleared: { beforeKeys: number; afterKeys: number };
    timestamp: string;
  }> {
    if (!this.mailQueue) {
      return {
        success: false,
        message: 'Mail queue is not initialized or Redis is disabled.',
        cleared: { beforeKeys: 0, afterKeys: 0 },
        timestamp: new Date().toISOString(),
      };
    }

    let beforeKeys = 0;
    let afterKeys = 0;

    try {
      const client = await (this.mailQueue as any).backend?.client;
      if (client && client.dbsize) {
        beforeKeys = await client.dbsize();
      }

      // Xóa tất cả các trạng thái jobs trong BullMQ
      await Promise.all([
        this.mailQueue.clean(0, 10000, 'completed'),
        this.mailQueue.clean(0, 10000, 'failed'),
        this.mailQueue.clean(0, 10000, 'delayed'),
        this.mailQueue.clean(0, 10000, 'wait'),
      ]);
      await this.mailQueue.drain(true);

      // Nếu client hỗ trợ flushdb, thực thi dọn triệt để
      if (client && client.flushdb) {
        await client.flushdb();
        afterKeys = await client.dbsize();
      }

      this.logger.log(
        `🧹 [MailQueue] Redis cleaned successfully (before: ${beforeKeys}, after: ${afterKeys} keys)`,
      );

      return {
        success: true,
        message: `Đã dọn dẹp hàng đợi BullMQ và làm sạch Redis thành công (${beforeKeys} -> ${afterKeys} keys)`,
        cleared: { beforeKeys, afterKeys },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        `❌ [MailQueue] Failed to clean Redis: ${(error as Error).message}`,
      );
      return {
        success: false,
        message: `Lỗi khi dọn dẹp Redis: ${(error as Error).message}`,
        cleared: { beforeKeys, afterKeys },
        timestamp: new Date().toISOString(),
      };
    }
  }
}
