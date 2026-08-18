import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderEntity } from './infrastructure/persistence/relational/entities/order.entity';
import { UserEntity } from '../users/infrastructure/persistence/relational/entities/user.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { QueryOrderDto } from './dto/query-order.dto';
import { QueryOrderStatsDto } from './dto/query-order-stats.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { RoleEnum } from '../roles/roles.enum';

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface OrderStatsResult {
  total: number;
  pending: number;      // PENDING_FLEET
  assigned: number;     // ASSIGNED
  inTransit: number;    // IN_TRANSIT
  delivered: number;    // DELIVERED
  noVehicle: number;    // NO_VEHICLE
  cancelled: number;    // CANCELLED
  fromDate: string;
  toDate: string;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(OrderEntity)
    private readonly orderRepository: Repository<OrderEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly notificationsService: NotificationsService,
    private readonly mailService: MailService,
  ) {}

  async create(
    createOrderDto: CreateOrderDto,
    userId?: number,
  ): Promise<OrderEntity> {
    const existing = await this.orderRepository.findOne({
      where: { orderCode: createOrderDto.orderCode.trim() },
    });

    if (existing) {
      throw new UnprocessableEntityException(
        'Mã đơn hàng đã tồn tại, vui lòng chọn mã khác',
      );
    }

    if (
      createOrderDto.isExternalVehicleNeeded &&
      !createOrderDto.externalNote?.trim()
    ) {
      throw new UnprocessableEntityException(
        'Đơn hàng yêu cầu điều xe ngoài / thuê đối tác bắt buộc phải nhập ghi chú/lý do điều xe ngoài (external_note)',
      );
    }

    const order = this.orderRepository.create({
      ...createOrderDto,
      orderCode: createOrderDto.orderCode.trim(),
      status: 'DRAFT',
      createdByUserId: userId,
    });

    return this.orderRepository.save(order);
  }

  async findAll(query?: QueryOrderDto): Promise<PaginatedResult<OrderEntity>> {
    const page = query?.page ?? 1;
    const limit = query?.limit ?? 20;
    const skip = (page - 1) * limit;

    const qb = this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.trips', 'trips')
      .leftJoinAndSelect('trips.vehicle', 'vehicle')
      .leftJoinAndSelect('trips.driver', 'driver')
      .where('order.deletedAt IS NULL')
      .orderBy('order.createdAt', 'DESC');

    if (query?.status && query.status !== 'ALL') {
      // PENDING_ASSIGNMENT là alias cho trips page: lấy cả PENDING_FLEET + NO_VEHICLE
      if (query.status === 'PENDING_ASSIGNMENT') {
        qb.andWhere("order.status IN ('PENDING_FLEET', 'NO_VEHICLE')");
      } else {
        qb.andWhere('order.status = :status', { status: query.status });
      }
    }

    if (query?.search && query.search.trim()) {
      const search = `%${query.search.trim()}%`;
      qb.andWhere(
        '(order.orderCode ILIKE :search OR order.route ILIKE :search OR order.originHub ILIKE :search OR order.destinationHub ILIKE :search OR order.goodsDescription ILIKE :search)',
        { search },
      );
    }

    if (query?.originHub) {
      qb.andWhere('order.originHub = :originHub', {
        originHub: query.originHub,
      });
    }

    if (query?.destinationHub) {
      qb.andWhere('order.destinationHub = :destinationHub', {
        destinationHub: query.destinationHub,
      });
    }

    if (query?.fromDate) {
      const from = new Date(`${query.fromDate}T00:00:00`);
      qb.andWhere('order.createdAt >= :fromDate', {
        fromDate: from.toISOString(),
      });
    }

    if (query?.toDate) {
      const to = new Date(`${query.toDate}T23:59:59.999`);
      qb.andWhere('order.createdAt <= :toDate', {
        toDate: to.toISOString(),
      });
    }

    qb.skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getStats(query?: QueryOrderStatsDto): Promise<OrderStatsResult> {
    const now = new Date();

    // Default: đầu tháng hiện tại → hôm nay (23:59:59)
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
    const defaultTo = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const from = query?.fromDate ? new Date(`${query.fromDate}T00:00:00`) : defaultFrom;
    // toDate bao gồm hết ngày đó
    const to = query?.toDate ? new Date(`${query.toDate}T23:59:59.999`) : defaultTo;

    // Lấy count per status trong khoảng ngày
    const rows: Array<{ status: string; count: string }> = await this.orderRepository.query(
      `SELECT status, COUNT(*)::int AS count
       FROM "order"
       WHERE "deletedAt" IS NULL
         AND "createdAt" >= $1
         AND "createdAt" <= $2
       GROUP BY status`,
      [from.toISOString(), to.toISOString()],
    );

    const countMap: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      countMap[row.status] = Number(row.count);
      total += Number(row.count);
    }

    return {
      total,
      pending: countMap['PENDING_FLEET'] ?? 0,
      assigned: countMap['ASSIGNED'] ?? 0,
      inTransit: countMap['IN_TRANSIT'] ?? 0,
      delivered: countMap['DELIVERED'] ?? 0,
      noVehicle: countMap['NO_VEHICLE'] ?? 0,
      cancelled: countMap['CANCELLED'] ?? 0,
      fromDate: from.toISOString().split('T')[0],
      toDate: to.toISOString().split('T')[0],
    };
  }

  async findOne(id: number): Promise<OrderEntity> {
    const order = await this.orderRepository.findOne({
      where: { id },
      relations: ['trips', 'trips.vehicle', 'trips.driver'],
    });

    if (!order) {
      throw new NotFoundException(`Order with ID ${id} not found`);
    }

    return order;
  }

  async update(
    id: number,
    updateOrderDto: UpdateOrderDto,
  ): Promise<OrderEntity> {
    const order = await this.findOne(id);

    if (
      updateOrderDto.orderCode &&
      updateOrderDto.orderCode.trim() !== order.orderCode
    ) {
      const existing = await this.orderRepository.findOne({
        where: { orderCode: updateOrderDto.orderCode.trim() },
      });
      if (existing) {
        throw new UnprocessableEntityException(
          'Mã đơn hàng đã tồn tại, vui lòng chọn mã khác',
        );
      }
      order.orderCode = updateOrderDto.orderCode.trim();
    }

    const isExtNeeded =
      updateOrderDto.isExternalVehicleNeeded !== undefined
        ? updateOrderDto.isExternalVehicleNeeded
        : order.isExternalVehicleNeeded;
    const finalExtNote =
      updateOrderDto.externalNote !== undefined
        ? updateOrderDto.externalNote
        : order.externalNote;

    if (isExtNeeded && !finalExtNote?.trim()) {
      throw new UnprocessableEntityException(
        'Đơn hàng yêu cầu điều xe ngoài / thuê đối tác bắt buộc phải nhập ghi chú/lý do điều xe ngoài (external_note)',
      );
    }

    Object.assign(order, {
      ...updateOrderDto,
      orderCode: order.orderCode,
    });

    return this.orderRepository.save(order);
  }

  async submit(id: number): Promise<OrderEntity> {
    const order = await this.findOne(id);
    order.status = 'PENDING_FLEET';
    const saved = await this.orderRepository.save(order);

    // Notify Fleet Manager + Super Admin sau khi submit (non-blocking fire-and-forget)
    setImmediate(() => {
      this.sendOrderPendingFleetNotifications(saved).catch((err) => {
        this.logger.warn('Failed to dispatch order-pending-fleet notification:', err);
      });
    });

    return saved;
  }

  async markNoVehicle(id: number, reason?: string): Promise<OrderEntity> {
    const order = await this.findOne(id);
    order.status = 'NO_VEHICLE';
    if (reason && reason.trim()) {
      const timestamp = new Date().toLocaleDateString('vi-VN');
      const notePrefix = `[${timestamp} - Đội xe báo hết xe]: ${reason.trim()}`;
      order.notes = order.notes ? `${order.notes}\n${notePrefix}` : notePrefix;
    }
    const saved = await this.orderRepository.save(order);

    // Notify Dispatcher + Super Admin sau khi Fleet báo không có xe (non-blocking fire-and-forget)
    setImmediate(() => {
      this.sendOrderNoVehicleNotifications(saved, reason).catch((err) => {
        this.logger.warn('Failed to dispatch order-no-vehicle notification:', err);
      });
    });

    return saved;
  }


  async remove(id: number): Promise<void> {
    const order = await this.findOne(id);
    await this.orderRepository.softRemove(order);
  }

  // ---------------------------------------------------------------------------
  // Public helpers
  // ---------------------------------------------------------------------------

  /**
   * Loại bỏ dấu tiếng Việt và ký tự không phải ASCII khỏi chuỗi.
   * VD: "Đặng Anh" → "DANG ANH", "Ă" → "A", "Đ" → "D"
   *
   * Cơ chế:
   * 1. normalize('NFD')  → tách base-char + combining mark (e.g. "Đ" tách thành "D" + combining stroke)
   * 2. replace /\p{Diacritic}/gu → xoá mọi combining mark
   * 3. Riêng "đ/Đ" không có trong Unicode combining, phải replace thủ công trước.
   */
  private stripVietnamese(str: string): string {
    return str
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // strip combining diacritical marks
      .replace(/[^A-Z0-9]/gi, '')      // chỉ giữ alphanumeric
      .toUpperCase();
  }

  /**
   * Sinh mã đơn hàng tạm thời theo format [PREFIX]-[MMYY]-[NNN].
   *
   * - Prefix được strip dấu tiếng Việt (VD: "ĐA" → "DA", "Nguyễn" → "NGUYEN")
   * - Format: DA-0826-020  (prefix-MMYY-seq, 3 chữ số)
   * - Query DB tìm số thứ tự (seq) lớn nhất đang có → suggest maxSeq+1
   * - Loop tối đa 20 lần để tránh race condition
   */
  async generateOrderCode(prefix?: string): Promise<{ orderCode: string }> {
    // 1. Chuẩn hóa prefix: strip dấu tiếng Việt, chỉ giữ A-Z0-9, tối đa 5 ký tự
    const rawPrefix = (prefix || 'ORD').trim();
    const safePrefix = this.stripVietnamese(rawPrefix).slice(0, 5) || 'ORD';

    // 2. Build date part: MMYY (VD: tháng 8/2026 → "0826")
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yy = String(now.getFullYear()).slice(-2);
    const datePart = `${mm}${yy}`;

    // 3. Pattern LIKE để tìm mọi mã cùng prefix-datePart trong DB
    //    Format mới: PREFIX-MMYY-NNN  (VD: DA-0826-%)
    const likePattern = `${safePrefix}-${datePart}-%`;

    // 4. Lấy tất cả orderCode khớp pattern, extract số thứ tự, tìm max
    const rows: Array<{ orderCode: string }> = await this.orderRepository.query(
      `SELECT "orderCode" FROM "order"
       WHERE "orderCode" ILIKE $1 AND "deletedAt" IS NULL
       ORDER BY "orderCode" DESC
       LIMIT 100`,
      [likePattern],
    );

    // Parse phần số (sau dấu '-' cuối cùng) từ mỗi mã tìm được
    let maxSeq = 0;
    const prefixDate = `${safePrefix}-${datePart}-`;
    for (const row of rows) {
      if (!row.orderCode.toUpperCase().startsWith(prefixDate.toUpperCase())) continue;
      const seq = parseInt(row.orderCode.slice(prefixDate.length), 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }

    // 5. Tăng dần từ maxSeq+1, kiểm tra từng candidate để tránh race condition
    let candidate = '';
    for (let attempt = 1; attempt <= 20; attempt++) {
      const seq = maxSeq + attempt;
      candidate = `${prefixDate}${String(seq).padStart(3, '0')}`;
      const existing = await this.orderRepository.findOne({
        where: { orderCode: candidate },
      });
      if (!existing) break;
    }

    return { orderCode: candidate };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Gửi in-app notification + email cho tất cả FLEET_MANAGER và SUPER_ADMIN
   * khi Dispatcher submit order lên đội xe (DRAFT → PENDING_FLEET).
   * Cả 2 kênh (in-app + email) đều được gửi độc lập cho từng user.
   */
  private async sendOrderPendingFleetNotifications(
    order: OrderEntity,
  ): Promise<void> {
    this.logger.log(
      `[1] sendOrderPendingFleetNotifications START — orderId=${order.id} orderCode=${order.orderCode}`,
    );

    const recipients = await this.userRepository.manager.query<UserEntity[]>(
      `SELECT u.* FROM "user" u
       WHERE u."roleId" IN ($1, $2)
         AND u."deletedAt" IS NULL`,
      [RoleEnum.FLEET_MANAGER, RoleEnum.SUPER_ADMIN],
    );

    this.logger.log(
      `[2] Recipients found: ${recipients.length} — ${recipients.map((u) => u.email).join(', ')}`,
    );

    const route =
      order.route || `${order.originHub ?? ''} → ${order.destinationHub ?? ''}`;

    const title = order.isExternalVehicleNeeded
      ? `🚨 [XE NGOÀI] Đơn hàng ${order.orderCode} cần phân công xe thuê ngoài`
      : `📦 Đơn hàng mới cần phân công xe: ${order.orderCode}`;

    const qtyStr = order.totalQuantity ? ` | SL: ${order.totalQuantity.toLocaleString()} kiện` : '';
    const body = `Tuyến: ${route}${qtyStr} | KL: ${order.totalWeight} kg | ${order.totalVolume} m³${order.isExternalVehicleNeeded ? ' | 🚛 Cần xe ngoài' : ''}`;

    for (const user of recipients) {
      this.logger.log(`[3] Processing user id=${user.id} email=${user.email}`);

      // 1. In-app notification (bell icon + badge)
      try {
        await this.notificationsService.create({
          userId: user.id,
          title,
          body,
          type: 'FLEET',
          metadata: {
            orderId: order.id,
            orderCode: order.orderCode,
            route,
            isExternalVehicleNeeded: order.isExternalVehicleNeeded,
          },
        });
        this.logger.log(`[4] In-app notification created for userId=${user.id}`);
      } catch (e) {
        this.logger.error(`[4] In-app notification FAILED for userId=${user.id}: ${(e as Error).message}`);
      }

      // 2. Email — dùng template order-pending-fleet.hbs (riêng biệt)
      if (user.email) {
        this.logger.log(`[5] Sending email to ${user.email}...`);
        try {
          await this.mailService.sendOrderPendingFleetNotification({
            to: user.email,
            data: {
              recipientName: user.firstName ?? undefined,
              orderCode: order.orderCode,
              route,
              originHub: order.originHub ?? undefined,
              destinationHub: order.destinationHub ?? undefined,
              totalQuantity: order.totalQuantity ?? undefined,
              totalWeight: order.totalWeight,
              totalVolume: order.totalVolume,
              isExternalVehicleNeeded: order.isExternalVehicleNeeded ?? false,
              externalNote: order.externalNote ?? undefined,
              goodsDescription: order.goodsDescription ?? undefined,
              notes: order.notes ?? undefined,
              actionUrl: `/dashboard/trips`,
            },
          });
          this.logger.log(`[6] ✅ Email sent OK to ${user.email}`);
        } catch (e) {
          this.logger.error(`[6] ❌ Email FAILED to ${user.email}: ${(e as Error).message}`, (e as Error).stack);
        }
      } else {
        this.logger.warn(`[5] Skipping email — user id=${user.id} has no email`);
      }
    }

    this.logger.log(`[7] sendOrderPendingFleetNotifications DONE`);
  }

  /**
   * Gửi in-app notification + email cho DISPATCHER (người tạo đơn & các dispatcher)
   * và SUPER_ADMIN khi Đội xe báo hết xe (order chuyển sang trạng thái NO_VEHICLE).
   * Cả 2 kênh (in-app + email) đều được gửi độc lập cho từng user.
   */
  private async sendOrderNoVehicleNotifications(
    order: OrderEntity,
    reason?: string,
  ): Promise<void> {
    this.logger.log(
      `[1] sendOrderNoVehicleNotifications START — orderId=${order.id} orderCode=${order.orderCode}`,
    );

    // Lấy tất cả user có role DISPATCHER, SUPER_ADMIN hoặc là người tạo đơn
    const recipients = await this.userRepository.manager.query<UserEntity[]>(
      `SELECT DISTINCT u.* FROM "user" u
       WHERE (u."roleId" IN ($1, $2) OR u.id = $3)
         AND u."deletedAt" IS NULL`,
      [RoleEnum.DISPATCHER, RoleEnum.SUPER_ADMIN, order.createdByUserId || -1],
    );

    this.logger.log(
      `[2] Recipients found: ${recipients.length} — ${recipients.map((u) => u.email).join(', ')}`,
    );

    const route =
      order.route || `${order.originHub ?? ''} → ${order.destinationHub ?? ''}`;

    const finalReason =
      reason?.trim() || 'Hết phương tiện nội bộ khả dụng tại thời điểm điều phối';

    const title = `⚠️ [HẾT XE] Đơn hàng ${order.orderCode} - Đội xe báo không có xe nội bộ`;
    const body = `Lý do: ${finalReason} | Tuyến: ${route} | Vui lòng liên hệ xe thuê ngoài`;

    for (const user of recipients) {
      this.logger.log(`[3] Processing user id=${user.id} email=${user.email}`);

      // 1. In-app notification (bell icon + badge)
      try {
        await this.notificationsService.create({
          userId: user.id,
          title,
          body,
          type: 'DISPATCHER',
          metadata: {
            orderId: order.id,
            orderCode: order.orderCode,
            route,
            reason: finalReason,
            status: 'NO_VEHICLE',
          },
        });
        this.logger.log(`[4] In-app notification created for userId=${user.id}`);
      } catch (e) {
        this.logger.error(
          `[4] In-app notification FAILED for userId=${user.id}: ${(e as Error).message}`,
        );
      }

      // 2. Email — dùng template order-no-vehicle.hbs
      if (user.email) {
        this.logger.log(`[5] Sending email to ${user.email}...`);
        try {
          await this.mailService.sendOrderNoVehicleNotification({
            to: user.email,
            data: {
              recipientName: user.firstName ?? undefined,
              orderCode: order.orderCode,
              route,
              originHub: order.originHub ?? undefined,
              destinationHub: order.destinationHub ?? undefined,
              totalQuantity: order.totalQuantity ?? undefined,
              totalWeight: order.totalWeight,
              totalVolume: order.totalVolume,
              reason: finalReason,
              goodsDescription: order.goodsDescription ?? undefined,
              notes: order.notes ?? undefined,
              actionUrl: `/dashboard/orders/${order.id}`,
            },
          });
          this.logger.log(`[6] ✅ Email sent OK to ${user.email}`);
        } catch (e) {
          this.logger.error(
            `[6] ❌ Email FAILED to ${user.email}: ${(e as Error).message}`,
            (e as Error).stack,
          );
        }
      } else {
        this.logger.warn(`[5] Skipping email — user id=${user.id} has no email`);
      }
    }

    this.logger.log(`[7] sendOrderNoVehicleNotifications DONE`);
  }
}
