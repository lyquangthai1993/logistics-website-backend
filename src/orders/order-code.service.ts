import {
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { OrderCodeCounterEntity } from './infrastructure/persistence/relational/entities/order-code-counter.entity';
import { UserEntity } from '../users/infrastructure/persistence/relational/entities/user.entity';
import { HubEntity } from '../hubs/infrastructure/persistence/relational/entities/hub.entity';

@Injectable()
export class OrderCodeService {
  private readonly logger = new Logger(OrderCodeService.name);

  constructor(
    @InjectRepository(OrderCodeCounterEntity)
    private readonly counterRepository: Repository<OrderCodeCounterEntity>,
    @InjectRepository(HubEntity)
    private readonly hubRepository: Repository<HubEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Normalize Vietnamese full name and derive uppercase initials (e.g. "Lê Thâm Vương" -> "LTV", "Đức Anh" -> "DA").
   */
  extractInitials(name?: string | null): string {
    if (!name || !name.trim()) return 'OP';

    const normalized = name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .trim();

    if (!normalized) return 'OP';

    const words = normalized.split(/\s+/).filter((w) => w.length > 0);
    const initials = words.map((w) => w[0].toUpperCase()).join('');

    return initials.slice(0, 6) || 'OP';
  }

  /**
   * Get current YYMM period in Asia/Ho_Chi_Minh timezone.
   */
  getYearMonthPeriod(): string {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: '2-digit',
      month: '2-digit',
    });

    const parts = formatter.formatToParts(new Date());
    const month = parts.find((p) => p.type === 'month')?.value ?? '01';
    const year = parts.find((p) => p.type === 'year')?.value ?? '26';

    return `${year}${month}`; // e.g. "2609"
  }

  /**
   * Atomically generate canonical Order Code: {HUB_PREFIX}-{OPERATOR_INITIALS}-{YYMM}-{SEQUENCE}
   */
  async generateOrderCode(
    user: UserEntity,
    manager?: EntityManager,
  ): Promise<string> {
    const em = manager || this.dataSource.manager;

    let userWithHub = user;
    if (!userWithHub.hub && userWithHub.hubId) {
      const hub = await em.findOne(HubEntity, {
        where: { id: userWithHub.hubId },
      });
      if (hub) userWithHub.hub = hub;
    }

    if (!userWithHub.hub && !userWithHub.hubId) {
      // Fallback: If admin without hub, try finding default HCM hub
      const defaultHub = await em.findOne(HubEntity, {
        where: { code: 'HUB-HCM-01' },
      });
      if (defaultHub) {
        userWithHub.hub = defaultHub;
        userWithHub.hubId = defaultHub.id;
      } else {
        throw new UnprocessableEntityException(
          'Tài khoản tạo đơn chưa được gán Hub quản lý. Vui lòng liên hệ Admin.',
        );
      }
    }

    const hub = userWithHub.hub;
    if (!hub || !hub.isActive) {
      throw new UnprocessableEntityException(
        'Hub của tài khoản không hoạt động hoặc không tồn tại.',
      );
    }

    const hubPrefix =
      hub.orderCodePrefix ||
      (hub.code === 'HUB-HCM-01'
        ? 'HCM'
        : hub.code === 'HUB-DAD-01'
          ? 'DAD'
          : hub.code === 'HUB-HYN-01'
            ? 'HYN'
            : hub.code.replace('HUB-', '').replace('-01', '').replace(/-/g, '_'));

    const fullName = [userWithHub.firstName, userWithHub.lastName]
      .filter(Boolean)
      .join(' ')
      .trim() || userWithHub.username || 'OP';

    const operatorInitials = this.extractInitials(fullName);
    const yearMonth = this.getYearMonthPeriod();

    // Atomic increment using pessimistic row lock or upsert
    let counter = await em.findOne(OrderCodeCounterEntity, {
      where: {
        hubId: hub.id,
        operatorInitials,
        yearMonth,
      },
      lock: { mode: 'pessimistic_write' },
    });

    if (!counter) {
      counter = em.create(OrderCodeCounterEntity, {
        hubId: hub.id,
        operatorInitials,
        yearMonth,
        lastSequence: 1,
      });
      await em.save(counter);
    } else {
      counter.lastSequence += 1;
      await em.save(counter);
    }

    const seqStr =
      counter.lastSequence < 1000
        ? counter.lastSequence.toString().padStart(3, '0')
        : counter.lastSequence.toString();

    return `${hubPrefix}-${operatorInitials}-${yearMonth}-${seqStr}`;
  }
}
