import {
  Injectable,
  NotFoundException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationEntity } from './infrastructure/persistence/relational/entities/notification.entity';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { QueryNotificationDto } from './dto/query-notification.dto';
import { Notification } from './domain/notification';
import { NotificationsGateway } from './notifications.gateway';

export interface NotificationStatsResult {
  total: number;
  unread: number;
  read: number;
  byType: {
    DISPATCHER: number;
    FLEET: number;
    WAREHOUSE: number;
    GENERIC: number;
  };
  unreadByType: {
    DISPATCHER: number;
    FLEET: number;
    WAREHOUSE: number;
    GENERIC: number;
  };
}

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
    query: QueryNotificationDto = {},
  ): Promise<{
    data: Notification[];
    meta: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const queryBuilder = this.notificationRepo
      .createQueryBuilder('n')
      .where('n.userId = :userId', { userId });

    if (query.type) {
      queryBuilder.andWhere('n.type = :type', { type: query.type });
    }

    if (typeof query.isRead === 'boolean') {
      queryBuilder.andWhere('n.isRead = :isRead', { isRead: query.isRead });
    }

    if (query.search && query.search.trim()) {
      queryBuilder.andWhere(
        '(n.title ILIKE :search OR n.body ILIKE :search)',
        { search: `%${query.search.trim()}%` },
      );
    }

    queryBuilder
      .orderBy('n.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await queryBuilder.getManyAndCount();
    const totalPages = Math.ceil(total / limit) || 1;

    return {
      data: data as unknown as Notification[],
      meta: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  }

  async getStats(userId: number): Promise<NotificationStatsResult> {
    const raw = await this.notificationRepo
      .createQueryBuilder('n')
      .select('COUNT(*)::int', 'total')
      .addSelect('COUNT(CASE WHEN n.isRead = false THEN 1 END)::int', 'unread')
      .addSelect('COUNT(CASE WHEN n.isRead = true THEN 1 END)::int', 'read')
      .addSelect('COUNT(CASE WHEN n.type = :dispatcher THEN 1 END)::int', 'typeDispatcher')
      .addSelect('COUNT(CASE WHEN n.type = :fleet THEN 1 END)::int', 'typeFleet')
      .addSelect('COUNT(CASE WHEN n.type = :warehouse THEN 1 END)::int', 'typeWarehouse')
      .addSelect('COUNT(CASE WHEN n.type = :generic THEN 1 END)::int', 'typeGeneric')
      .addSelect('COUNT(CASE WHEN n.type = :dispatcher AND n.isRead = false THEN 1 END)::int', 'unreadDispatcher')
      .addSelect('COUNT(CASE WHEN n.type = :fleet AND n.isRead = false THEN 1 END)::int', 'unreadFleet')
      .addSelect('COUNT(CASE WHEN n.type = :warehouse AND n.isRead = false THEN 1 END)::int', 'unreadWarehouse')
      .addSelect('COUNT(CASE WHEN n.type = :generic AND n.isRead = false THEN 1 END)::int', 'unreadGeneric')
      .where('n.userId = :userId', { userId })
      .setParameters({
        dispatcher: 'DISPATCHER',
        fleet: 'FLEET',
        warehouse: 'WAREHOUSE',
        generic: 'GENERIC',
      })
      .getRawOne();

    return {
      total: Number(raw?.total ?? 0),
      unread: Number(raw?.unread ?? 0),
      read: Number(raw?.read ?? 0),
      byType: {
        DISPATCHER: Number(raw?.typeDispatcher ?? 0),
        FLEET: Number(raw?.typeFleet ?? 0),
        WAREHOUSE: Number(raw?.typeWarehouse ?? 0),
        GENERIC: Number(raw?.typeGeneric ?? 0),
      },
      unreadByType: {
        DISPATCHER: Number(raw?.unreadDispatcher ?? 0),
        FLEET: Number(raw?.unreadFleet ?? 0),
        WAREHOUSE: Number(raw?.unreadWarehouse ?? 0),
        GENERIC: Number(raw?.unreadGeneric ?? 0),
      },
    };
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
    return this.notificationRepo.save(
      notification,
    ) as unknown as Promise<Notification>;
  }

  async markAllAsRead(userId: number): Promise<{ affected: number }> {
    const result = await this.notificationRepo.update(
      { userId, isRead: false },
      { isRead: true },
    );
    return { affected: result.affected ?? 0 };
  }
}

