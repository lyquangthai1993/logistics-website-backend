import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import {
  OrderActivityAction,
  OrderActivityLogEntity,
} from './infrastructure/persistence/relational/entities/order-activity-log.entity';
import { OrderEntity } from './infrastructure/persistence/relational/entities/order.entity';
import { UserEntity } from '../users/infrastructure/persistence/relational/entities/user.entity';
import {
  InventoryTransactionType,
  OrderInventoryTransactionEntity,
} from './infrastructure/persistence/relational/entities/order-inventory-transaction.entity';
import { CreateOrderActivityLogDto } from './dto/create-order-activity-log.dto';

export { CreateOrderActivityLogDto };

@Injectable()
export class OrderActivityLogService {
  private readonly logger = new Logger(OrderActivityLogService.name);

  constructor(
    @InjectRepository(OrderActivityLogEntity)
    private readonly activityLogRepo: Repository<OrderActivityLogEntity>,
    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,
    @InjectRepository(OrderInventoryTransactionEntity)
    private readonly txRepo: Repository<OrderInventoryTransactionEntity>,
  ) {}

  /**
   * Record a new order activity log entry.
   * Can run within an existing TypeORM transaction via `manager`.
   */
  async logActivity(
    dto: CreateOrderActivityLogDto,
    manager?: EntityManager,
  ): Promise<OrderActivityLogEntity> {
    if (dto.actorUserId === undefined || dto.actorUserId === null) {
      throw new BadRequestException(
        'actorUserId là bắt buộc và không được null khi ghi nhật ký hoạt động đơn hàng.',
      );
    }
    if (dto.hubId === undefined || dto.hubId === null) {
      throw new BadRequestException(
        'hubId là bắt buộc và không được null khi ghi nhật ký hoạt động đơn hàng.',
      );
    }

    // Tự động truy vấn email / hubId nếu chưa có
    let userRecord: UserEntity | null = null;
    if (
      (!dto.actorEmail || !Number.isFinite(Number(dto.hubId))) &&
      dto.actorUserId
    ) {
      const userRepo = manager
        ? manager.getRepository(UserEntity)
        : this.activityLogRepo.manager.getRepository(UserEntity);
      userRecord = await userRepo.findOne({
        where: { id: Number(dto.actorUserId) },
      });
      if (!dto.actorEmail && userRecord?.email) {
        dto.actorEmail = userRecord.email;
      }
    }

    if (!dto.actorEmail) {
      throw new BadRequestException(
        'actorEmail là bắt buộc và không được null khi ghi nhật ký hoạt động đơn hàng.',
      );
    }

    const resolvedHubId = Number.isFinite(Number(dto.hubId))
      ? Number(dto.hubId)
      : Number(userRecord?.hubId) || 0;

    try {
      const repo = manager
        ? manager.getRepository(OrderActivityLogEntity)
        : this.activityLogRepo;

      const log = repo.create({
        orderId: dto.orderId ?? null,
        orderCode: dto.orderCode,
        action: dto.action,
        actorUserId: Number(dto.actorUserId) || 0,
        actorEmail: dto.actorEmail,
        actorRole: dto.actorRole ?? null,
        hubId: resolvedHubId,
        hubName: dto.hubName ?? null,
        tripCode: dto.tripCode ?? null,
        oldValues: dto.oldValues ?? null,
        newValues: dto.newValues ?? null,
        quantity: dto.quantity !== undefined ? dto.quantity : null,
        reason: dto.reason ?? null,
        bearerToken: dto.bearerToken ?? null,
        metadata: dto.metadata ?? null,
      });

      const saved = await repo.save(log);
      this.logger.log(
        `[AUDIT] Action=${dto.action} Code=${dto.orderCode} User=${dto.actorEmail} Hub=${resolvedHubId} Reason=${dto.reason || 'N/A'}`,
      );
      return saved;
    } catch (err: any) {
      this.logger.error(
        `Failed to record order activity log for ${dto.orderCode}: ${err.message}`,
        err.stack,
      );
      throw err;
    }
  }

  /**
   * Non-blocking / resilient wrapper for operational workflow hooks (create, inbound, outbound, draft cancel)
   * so that missing user email/hub metadata never aborts the operational transaction.
   */
  async safeLogActivity(
    dto: Partial<CreateOrderActivityLogDto> & {
      orderCode: string;
      action: OrderActivityAction | string;
    },
    manager?: EntityManager,
  ): Promise<OrderActivityLogEntity | null> {
    try {
      const actorUserId = Number(dto.actorUserId) || 0;
      let actorEmail = dto.actorEmail || null;
      let actorRole = dto.actorRole || null;
      let hubId = Number.isFinite(Number(dto.hubId)) ? Number(dto.hubId) : 0;

      if ((!actorEmail || !actorRole || !hubId) && actorUserId > 0) {
        const userRepo = manager
          ? manager.getRepository(UserEntity)
          : this.activityLogRepo.manager.getRepository(UserEntity);
        const u = await userRepo.findOne({
          where: { id: actorUserId },
          relations: ['role', 'hub'],
        });
        if (u) {
          actorEmail =
            actorEmail || u.email || `user-${u.id}@spider-express.vn`;
          actorRole =
            actorRole ||
            (typeof u.role === 'object'
              ? (u.role as any)?.name
              : String(u.role || '')) ||
            null;
          if (!hubId && u.hubId) {
            hubId = Number(u.hubId) || 0;
          }
          if (!dto.hubName && (u as any).hub?.name) {
            dto.hubName = (u as any).hub.name;
          }
        }
      }

      if (!actorEmail) {
        actorEmail = 'system@spider-express.vn';
      }

      return await this.logActivity(
        {
          orderId: dto.orderId ?? null,
          orderCode: dto.orderCode,
          action: dto.action,
          actorUserId,
          actorEmail,
          actorRole: actorRole ?? 'OPERATOR',
          hubId,
          hubName: dto.hubName ?? 'N/A Hub',
          tripCode: dto.tripCode ?? null,
          oldValues: dto.oldValues ?? null,
          newValues: dto.newValues ?? null,
          quantity: dto.quantity,
          reason: dto.reason ?? null,
          bearerToken: dto.bearerToken ?? null,
          metadata: dto.metadata ?? null,
        },
        manager,
      );
    } catch (err: any) {
      this.logger.warn(
        `[safeLogActivity] Non-fatal warning for ${dto.orderCode} (${dto.action}): ${err.message}`,
      );
      return null;
    }
  }

  /**
   * Retrieve chronological activity logs for an orderCode.
   */
  async getActivityLogs(
    orderCode: string,
    orderId?: number,
  ): Promise<OrderActivityLogEntity[]> {
    const qb = this.activityLogRepo
      .createQueryBuilder('log')
      .where('log.orderCode = :orderCode', { orderCode })
      .orderBy('log.createdAt', 'DESC');

    if (orderId) {
      qb.orWhere('log.orderId = :orderId', { orderId });
    }

    return qb.getMany();
  }

  /**
   * Reconcile an order's cached quantities with actual active inventory transactions.
   */
  async reconcileOrderQuantities(
    orderCode: string,
    performedByUser?: { id?: number; email?: string; role?: string },
    reason = 'System reconciliation with active inventory ledger',
    manager?: EntityManager,
  ): Promise<{
    reconciled: boolean;
    orderId: number;
    orderCode: string;
    oldValues: Record<string, any>;
    newValues: Record<string, any>;
  }> {
    const orderR = manager
      ? manager.getRepository(OrderEntity)
      : this.orderRepo;
    const txR = manager
      ? manager.getRepository(OrderInventoryTransactionEntity)
      : this.txRepo;

    const orders = await orderR.find({
      where: { orderCode },
      order: { id: 'ASC' },
    });

    if (orders.length === 0) {
      return {
        reconciled: false,
        orderId: 0,
        orderCode,
        oldValues: {},
        newValues: {},
      };
    }

    const primaryOrder = orders[0];
    const orderIds = orders.map((o) => o.id);

    // Sum active transactions
    const activeTxs = await txR
      .createQueryBuilder('tx')
      .where('tx.orderId IN (:...orderIds)', { orderIds })
      .andWhere('tx.deletedAt IS NULL')
      .getMany();

    const totalInbound = activeTxs
      .filter((t) => t.type === InventoryTransactionType.INBOUND)
      .reduce((s, t) => s + (Number(t.quantity) || 0), 0);

    const totalOutbound = activeTxs
      .filter(
        (t) =>
          t.type === InventoryTransactionType.OUTBOUND ||
          t.type === InventoryTransactionType.TRANSFER,
      )
      .reduce((s, t) => s + (Number(t.quantity) || 0), 0);

    const exactRemaining = Math.max(0, totalInbound - totalOutbound);

    const oldValues = {
      totalQuantity: primaryOrder.totalQuantity,
      inboundQuantity: primaryOrder.inboundQuantity,
      outboundQuantity: primaryOrder.outboundQuantity,
      remainingQuantity: primaryOrder.remainingQuantity,
      status: primaryOrder.status,
    };

    // If transactions exist, the real totalQuantity & inboundQuantity must match actual inbound transactions
    if (activeTxs.length > 0) {
      primaryOrder.inboundQuantity = totalInbound;
      primaryOrder.outboundQuantity = totalOutbound;
      primaryOrder.remainingQuantity = exactRemaining;
      primaryOrder.totalQuantity = totalInbound; // Exact physical quantity received
      if (exactRemaining === 0 && totalOutbound > 0) {
        primaryOrder.status = 'COMPLETED_INBOUND';
      } else if (totalInbound > 0) {
        primaryOrder.status = 'INBOUND';
      }
    }

    await orderR.save(primaryOrder);

    const newValues = {
      totalQuantity: primaryOrder.totalQuantity,
      inboundQuantity: primaryOrder.inboundQuantity,
      outboundQuantity: primaryOrder.outboundQuantity,
      remainingQuantity: primaryOrder.remainingQuantity,
      status: primaryOrder.status,
    };

    const hasChanged =
      oldValues.totalQuantity !== newValues.totalQuantity ||
      oldValues.inboundQuantity !== newValues.inboundQuantity ||
      oldValues.outboundQuantity !== newValues.outboundQuantity ||
      oldValues.remainingQuantity !== newValues.remainingQuantity;

    if (hasChanged) {
      await this.logActivity(
        {
          orderId: primaryOrder.id,
          orderCode: primaryOrder.orderCode,
          action: OrderActivityAction.DATA_RECONCILED,
          actorUserId: Number(performedByUser?.id),
          actorEmail: performedByUser?.email || 'System Automated Reconciler',
          actorRole: performedByUser?.role || 'SYSTEM',
          hubId: Number(primaryOrder.currentHubId || primaryOrder.originHubId),
          hubName:
            primaryOrder.currentHubEntity?.name ||
            primaryOrder.originHub ||
            'N/A Hub',
          oldValues,
          newValues,
          reason,
        },
        manager,
      );
    }

    return {
      reconciled: hasChanged,
      orderId: primaryOrder.id,
      orderCode: primaryOrder.orderCode,
      oldValues,
      newValues,
    };
  }
}
