import { Injectable, NotFoundException, forwardRef, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationEntity } from './infrastructure/persistence/relational/entities/notification.entity';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { Notification } from './domain/notification';
import { NotificationsGateway } from './notifications.gateway';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(NotificationEntity)
    private readonly notificationRepo: Repository<NotificationEntity>,
    @Inject(forwardRef(() => NotificationsGateway))
    private readonly gateway: NotificationsGateway,
  ) {}

  async create(dto: CreateNotificationDto): Promise<Notification> {
    const entity = this.notificationRepo.create({
      userId: dto.userId,
      title: dto.title,
      body: dto.body,
      type: dto.type ?? 'GENERIC',
      metadata: dto.metadata,
      isRead: false,
    });
    const saved = await this.notificationRepo.save(entity);

    // Push real-time qua WebSocket (fire-and-forget, không block)
    try {
      this.gateway.emitToUser(saved.userId, saved as unknown as Notification);
    } catch {
      // Gateway chưa init hoặc user offline — không cần throw
    }

    return saved;
  }

  async findAllByUser(
    userId: number,
    page: number = 1,
    limit: number = 20,
  ): Promise<{ data: Notification[]; total: number; page: number; limit: number }> {
    const [data, total] = await this.notificationRepo.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit };
  }

  async countUnread(userId: number): Promise<number> {
    return this.notificationRepo.count({
      where: { userId, isRead: false },
    });
  }

  async markAsRead(id: number, userId: number): Promise<Notification> {
    const notification = await this.notificationRepo.findOne({
      where: { id, userId },
    });
    if (!notification) {
      throw new NotFoundException(`Notification #${id} not found`);
    }
    notification.isRead = true;
    return this.notificationRepo.save(notification) as unknown as Promise<Notification>;
  }

  async markAllAsRead(userId: number): Promise<{ affected: number }> {
    const result = await this.notificationRepo.update(
      { userId, isRead: false },
      { isRead: true },
    );
    return { affected: result.affected ?? 0 };
  }
}
