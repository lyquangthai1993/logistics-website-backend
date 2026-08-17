import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { I18nContext } from 'nestjs-i18n';
import { MailData } from './interfaces/mail-data.interface';

import { MaybeType } from '../utils/types/maybe.type';
import { MailerService } from '../mailer/mailer.service';
import path from 'path';
import { AllConfigType } from '../config/config.type';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class MailService {
  constructor(
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService<AllConfigType>,
    private readonly notificationsService: NotificationsService,
  ) {}

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
      templatePath: path.join(
        this.configService.getOrThrow('app.workingDirectory', {
          infer: true,
        }),
        'src',
        'mail',
        'mail-templates',
        'activation.hbs',
      ),
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
    const i18n = I18nContext.current();
    let resetPasswordTitle: MaybeType<string>;
    let text1: MaybeType<string>;
    let text2: MaybeType<string>;
    let text3: MaybeType<string>;
    let text4: MaybeType<string>;

    if (i18n) {
      [resetPasswordTitle, text1, text2, text3, text4] = await Promise.all([
        i18n.t('common.resetPassword'),
        i18n.t('reset-password.text1'),
        i18n.t('reset-password.text2'),
        i18n.t('reset-password.text3'),
        i18n.t('reset-password.text4'),
      ]);
    }

    const url = new URL(
      this.configService.getOrThrow('app.frontendDomain', {
        infer: true,
      }) + '/password-change',
    );
    url.searchParams.set('hash', mailData.data.hash);
    url.searchParams.set('expires', mailData.data.tokenExpires.toString());

    await this.mailerService.sendMail({
      to: mailData.to,
      subject: resetPasswordTitle,
      text: `${url.toString()} ${resetPasswordTitle}`,
      templatePath: path.join(
        this.configService.getOrThrow('app.workingDirectory', {
          infer: true,
        }),
        'src',
        'mail',
        'mail-templates',
        'reset-password.hbs',
      ),
      context: {
        title: resetPasswordTitle,
        url: url.toString(),
        actionTitle: resetPasswordTitle,
        app_name: this.configService.get('app.name', {
          infer: true,
        }),
        text1,
        text2,
        text3,
        text4,
      },
    });
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
      templatePath: path.join(
        this.configService.getOrThrow('app.workingDirectory', {
          infer: true,
        }),
        'src',
        'mail',
        'mail-templates',
        'confirm-new-email.hbs',
      ),
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

  async sendWarehouseNotification(
    mailData: MailData<
      import('./interfaces/logistics-mail-data.interface').WarehouseNotificationData
    > & { userId?: number },
  ): Promise<void> {
    const templatePath = path.join(
      this.configService.getOrThrow('app.workingDirectory', { infer: true }),
      'src',
      'mail',
      'mail-templates',
      'warehouse-notification.hbs',
    );

    // Chạy song song: email + in-app notification (fire-and-forget, không transaction)
    await Promise.all([
      this.mailerService.sendMail({
        to: mailData.to,
        subject: mailData.data.title,
        text: `${mailData.data.title} - Hub: ${mailData.data.hubName}`,
        templatePath,
        context: {
          ...mailData.data,
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
    const templatePath = path.join(
      this.configService.getOrThrow('app.workingDirectory', { infer: true }),
      'src',
      'mail',
      'mail-templates',
      'fleet-notification.hbs',
    );

    // Chạy song song: email + in-app notification (fire-and-forget, không transaction)
    await Promise.all([
      this.mailerService.sendMail({
        to: mailData.to,
        subject: mailData.data.title,
        text: `${mailData.data.title} - Xe: ${mailData.data.vehiclePlate} (${mailData.data.tripCode})`,
        templatePath,
        context: {
          ...mailData.data,
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
    const templatePath = path.join(
      this.configService.getOrThrow('app.workingDirectory', { infer: true }),
      'src',
      'mail',
      'mail-templates',
      'dispatcher-notification.hbs',
    );

    // Chạy song song: email + in-app notification (fire-and-forget, không transaction)
    await Promise.all([
      this.mailerService.sendMail({
        to: mailData.to,
        subject: mailData.data.title,
        text: `${mailData.data.title} - Mã đơn: ${mailData.data.orderCode}`,
        templatePath,
        context: {
          ...mailData.data,
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
    const templatePath = path.join(
      this.configService.getOrThrow('app.workingDirectory', { infer: true }),
      'src',
      'mail',
      'mail-templates',
      'generic-notification.hbs',
    );

    await this.mailerService.sendMail({
      to: mailData.to,
      subject: mailData.data.title,
      text: `${mailData.data.title}: ${mailData.data.message}`,
      templatePath,
      context: {
        ...mailData.data,
        app_name: this.configService.get('app.name', { infer: true }),
      },
    });
  }
}
