import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { OrderEntity } from './infrastructure/persistence/relational/entities/order.entity';
import { UserEntity } from '../users/infrastructure/persistence/relational/entities/user.entity';
import { HubEntity } from '../hubs/infrastructure/persistence/relational/entities/hub.entity';
import {
  OrderInventoryTransactionEntity,
  InventoryTransactionType,
} from './infrastructure/persistence/relational/entities/order-inventory-transaction.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { QueryOrderDto } from './dto/query-order.dto';
import { QueryOrderStatsDto } from './dto/query-order-stats.dto';
import { AdminOverrideOrderDto } from './dto/admin-override-order.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { RoleEnum } from '../roles/roles.enum';
import {
  CONTRACT_FIELDS,
  OperationalLedgerService,
} from './operational-ledger.service';

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
  pending: number; // PENDING_FLEET
  assigned: number; // ASSIGNED
  inTransit: number; // IN_TRANSIT
  delivered: number; // DELIVERED
  noVehicle: number; // NO_VEHICLE
  cancelled: number; // CANCELLED
  fromDate: string;
  toDate: string;
}

export interface OrderLedgerEntry {
  id: number;
  type: string;
  invoiceCode: string | null;
  hubId: number | null;
  hubName: string | null;
  tripCode: string | null;
  licensePlate: string | null;
  driverName: string | null;
  quantity: number;
  expectedQuantity: number | null;
  discrepancyQuantity: number;
  discrepancyReason: string | null;
  remainingQuantity: number;
  weight: number;
  volume: number;
  destination: string | null;
  notes: string | null;
  performedByUserId: number | null;
  performedByName: string | null;
  createdAt: Date;
}

import { OrderCodeService } from './order-code.service';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(OrderEntity)
    private readonly orderRepository: Repository<OrderEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(HubEntity)
    private readonly hubRepository: Repository<HubEntity>,
    @InjectRepository(OrderInventoryTransactionEntity)
    private readonly transactionRepository: Repository<OrderInventoryTransactionEntity>,
    private readonly orderCodeService: OrderCodeService,
    private readonly ledgerService: OperationalLedgerService,
    private readonly notificationsService: NotificationsService,
    private readonly mailService: MailService,
    private readonly dataSource: DataSource,
  ) {}

  async create(
    createOrderDto: CreateOrderDto,
    userId?: number,
  ): Promise<OrderEntity> {
    let finalCode = createOrderDto.orderCode?.trim();

    if (!finalCode) {
      const user = userId
        ? await this.userRepository.findOne({
            where: { id: userId },
            relations: ['hub'],
          })
        : null;

      if (!user) {
        throw new UnprocessableEntityException(
          'Không tìm thấy thông tin tài khoản để tự sinh mã đơn hàng.',
        );
      }
      finalCode = await this.orderCodeService.generateOrderCode(user);
    }

    if (
      createOrderDto.isExternalVehicleNeeded &&
      !createOrderDto.externalNote?.trim()
    ) {
      throw new UnprocessableEntityException(
        'Đơn hàng yêu cầu điều xe ngoài / thuê đối tác bắt buộc phải nhập ghi chú/lý do điều xe ngoài (external_note)',
      );
    }

    const initQty = createOrderDto.totalQuantity ?? 1;
    const order = this.orderRepository.create({
      ...createOrderDto,
      orderCode: finalCode,
      totalQuantity: initQty,
      inboundQuantity: initQty,
      outboundQuantity: 0,
      remainingQuantity: initQty,
      status: 'DRAFT',
      createdByUserId: userId,
    });

    return this.orderRepository.save(order);
  }

  async refreshMetrics(orderIds: number[]): Promise<
    Array<{
      id: number;
      orderCode: string;
      totalQuantity: number | null;
      totalWeight: number;
      totalVolume: number;
      status: string;
      updatedAt: Date;
    }>
  > {
    if (!orderIds || orderIds.length === 0) return [];
    const orders = await this.orderRepository
      .createQueryBuilder('order')
      .where('order.id IN (:...orderIds)', { orderIds })
      .andWhere('order.deletedAt IS NULL')
      .getMany();

    return orders.map((o) => ({
      id: o.id,
      orderCode: o.orderCode,
      totalQuantity: o.totalQuantity,
      totalWeight: o.totalWeight,
      totalVolume: o.totalVolume,
      status: o.status,
      updatedAt: o.updatedAt,
    }));
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
    const defaultTo = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59,
      999,
    );

    const from = query?.fromDate
      ? new Date(`${query.fromDate}T00:00:00`)
      : defaultFrom;
    // toDate bao gồm hết ngày đó
    const to = query?.toDate
      ? new Date(`${query.toDate}T23:59:59.999`)
      : defaultTo;

    // Lấy count per status trong khoảng ngày
    const rows: Array<{ status: string; count: string }> =
      await this.orderRepository.query(
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

  async checkCodeExists(
    code: string,
  ): Promise<{ exists: boolean; message?: string }> {
    return { exists: false };
  }

  async findOne(idOrCode: number | string): Promise<OrderEntity> {
    let order: OrderEntity | null = null;

    if (
      typeof idOrCode === 'number' ||
      (!isNaN(Number(idOrCode)) && Number.isInteger(Number(idOrCode)))
    ) {
      order = await this.orderRepository.findOne({
        where: { id: Number(idOrCode) },
        relations: [
          'trips',
          'inventoryTransactions',
          'originHubEntity',
          'destinationHubEntity',
          'currentHubEntity',
        ],
      });
    }

    if (!order && typeof idOrCode === 'string' && idOrCode.trim()) {
      order = await this.orderRepository.findOne({
        where: { orderCode: idOrCode.trim() },
        relations: [
          'trips',
          'inventoryTransactions',
          'originHubEntity',
          'destinationHubEntity',
          'currentHubEntity',
        ],
      });
    }

    if (!order) {
      throw new NotFoundException(
        `Order with ID or code '${idOrCode}' not found`,
      );
    }

    return order;
  }

  /**
   * Returns the contract fields whose incoming value differs from the persisted value.
   * Unchanged values (frontend re-sending the whole form) are not treated as modifications.
   */
  private getChangedContractFields(
    order: OrderEntity,
    dto: Record<string, any>,
  ): string[] {
    const normalize = (v: any) => {
      if (v === undefined || v === null || v === '') return null;
      if (typeof v === 'number') return Number(v);
      if (typeof v === 'string') {
        const trimmed = v.trim();
        const asNum = Number(trimmed);
        return trimmed !== '' && !isNaN(asNum) && /^-?\d+(\.\d+)?$/.test(trimmed)
          ? asNum
          : trimmed;
      }
      return v;
    };
    return CONTRACT_FIELDS.filter((field) => {
      if (!(field in dto) || dto[field] === undefined) return false;
      return normalize(dto[field]) !== normalize((order as any)[field]);
    });
  }

  async update(
    id: number,
    updateOrderDto: UpdateOrderDto,
  ): Promise<OrderEntity> {
    const order = await this.findOne(id);

    // ── Master Contract Immutability Guard ──
    // After leaving DRAFT, contract fields are locked for every role.
    // SUPER_ADMIN must use PATCH /orders/:id/admin-override (mandatory audit reason).
    if (order.status !== 'DRAFT') {
      const changed = this.getChangedContractFields(
        order,
        updateOrderDto as Record<string, any>,
      );
      if (changed.length > 0) {
        throw new ForbiddenException(
          'Hợp đồng gốc của đơn hàng đã được khóa sau khi gửi đi (số kiện, khối lượng, thể tích, mô tả hàng, nơi gửi, nơi nhận). Chỉ Quản trị viên được điều chỉnh qua chức năng "Điều chỉnh hợp đồng gốc" kèm lý do.',
        );
      }
    }

    if (
      updateOrderDto.orderCode &&
      updateOrderDto.orderCode.trim() !== order.orderCode
    ) {
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

  /**
   * SUPER_ADMIN-only override of Master Contract fields.
   * Writes an ADJUSTMENT invoice (DCH-...) containing old → new values and the audit reason.
   * Operational stock (inbound/outbound/remaining quantities) is NOT modified.
   */
  async adminOverride(
    id: number,
    dto: AdminOverrideOrderDto,
    admin: UserEntity,
  ): Promise<OrderEntity> {
    if (admin?.role?.id !== RoleEnum.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Chỉ Quản trị viên hệ thống được phép điều chỉnh hợp đồng gốc.',
      );
    }

    const auditReason = dto.auditReason?.trim();
    if (!auditReason) {
      throw new UnprocessableEntityException(
        'Vui lòng nhập lý do điều chỉnh hợp đồng gốc.',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const orderRepo = manager.getRepository(OrderEntity);
      const txRepo = manager.getRepository(OrderInventoryTransactionEntity);
      const hubRepo = manager.getRepository(HubEntity);

      const order = await orderRepo.findOne({ where: { id } });
      if (!order) {
        throw new NotFoundException('Không tìm thấy đơn hàng cần điều chỉnh.');
      }

      const LABELS: Record<string, string> = {
        totalQuantity: 'Số kiện',
        totalWeight: 'Khối lượng (kg)',
        totalVolume: 'Thể tích (m³)',
        goodsDescription: 'Mô tả hàng',
        originHubId: 'Kho gửi',
        destinationHubId: 'Kho nhận',
      };
      const changes: string[] = [];

      const applyScalar = (
        field: 'totalQuantity' | 'totalWeight' | 'totalVolume' | 'goodsDescription',
      ) => {
        const next = dto[field];
        if (next === undefined || next === null) return;
        const prev = order[field];
        const nextVal =
          typeof next === 'string' ? next.trim() : Number(next);
        if (nextVal === '' || nextVal === prev) return;
        changes.push(`${LABELS[field]}: ${prev ?? '—'} → ${nextVal}`);
        (order as any)[field] = nextVal;
      };
      applyScalar('totalQuantity');
      applyScalar('totalWeight');
      applyScalar('totalVolume');
      applyScalar('goodsDescription');

      const applyHub = async (
        idField: 'originHubId' | 'destinationHubId',
        nameField: 'originHub' | 'destinationHub',
      ) => {
        const nextId = dto[idField];
        if (!nextId || nextId === order[idField]) return;
        const hub = await hubRepo.findOne({ where: { id: nextId } });
        if (!hub) {
          throw new UnprocessableEntityException(
            `${LABELS[idField]} không tồn tại trên hệ thống.`,
          );
        }
        changes.push(`${LABELS[idField]}: ${order[nameField] ?? '—'} → ${hub.name}`);
        order[idField] = hub.id;
        order[nameField] = hub.name;
      };
      await applyHub('originHubId', 'originHub');
      await applyHub('destinationHubId', 'destinationHub');

      if (changes.length === 0) {
        throw new UnprocessableEntityException(
          'Không có thông tin hợp đồng nào thay đổi so với hiện tại.',
        );
      }

      if (dto.originHubId || dto.destinationHubId) {
        order.route = `${order.originHub ?? 'Kho gửi'} → ${order.destinationHub ?? 'Kho nhận'}`;
      }

      const saved = await orderRepo.save(order);

      const invoiceCode = await this.ledgerService.generateInvoiceCode(
        InventoryTransactionType.ADJUSTMENT,
        admin.hubId ?? null,
        manager,
      );
      await txRepo.save(
        txRepo.create({
          orderId: saved.id,
          type: InventoryTransactionType.ADJUSTMENT,
          invoiceCode,
          hubId: admin.hubId ?? null,
          quantity: 0,
          remainingQuantity: saved.remainingQuantity ?? 0,
          weight: 0,
          volume: 0,
          performedByUserId: admin.id,
          discrepancyReason: auditReason,
          notes: `Điều chỉnh hợp đồng gốc: ${changes.join('; ')}`,
        }),
      );

      this.logger.warn(
        `[ADMIN OVERRIDE] order=${saved.orderCode} by userId=${admin.id}: ${changes.join('; ')} | reason=${auditReason}`,
      );

      return saved;
    });
  }

  /**
   * Order Timeline Ledger: every operational invoice of the order in chronological order,
   * enriched with hub and performer names.
   */
  async getLedger(idOrCode: string): Promise<OrderLedgerEntry[]> {
    const order = await this.findOne(idOrCode);

    const rows: any[] = await this.transactionRepository.query(
      `SELECT tx.id, tx."type", tx."invoiceCode", tx."hubId", h."name" AS "hubName",
              tx."tripCode", tx."licensePlate", tx."driverName", tx."quantity",
              tx."expectedQuantity", tx."discrepancyQuantity", tx."discrepancyReason",
              tx."remainingQuantity", tx."weight", tx."volume", tx."destination", tx."notes",
              tx."performedByUserId",
              NULLIF(TRIM(CONCAT_WS(' ', u."firstName", u."lastName")), '') AS "performedByName",
              tx."createdAt"
       FROM "order_inventory_transaction" tx
       LEFT JOIN "hub" h ON h.id = tx."hubId"
       LEFT JOIN "user" u ON u.id = tx."performedByUserId"
       WHERE tx."orderId" = $1 AND tx."deletedAt" IS NULL
       ORDER BY tx."createdAt" ASC, tx.id ASC`,
      [order.id],
    );

    return rows.map((r) => ({
      id: Number(r.id),
      type: r.type,
      invoiceCode: r.invoiceCode ?? null,
      hubId: r.hubId != null ? Number(r.hubId) : null,
      hubName: r.hubName ?? null,
      tripCode: r.tripCode ?? null,
      licensePlate: r.licensePlate ?? null,
      driverName: r.driverName ?? null,
      quantity: Number(r.quantity) || 0,
      expectedQuantity:
        r.expectedQuantity != null ? Number(r.expectedQuantity) : null,
      discrepancyQuantity: Number(r.discrepancyQuantity) || 0,
      discrepancyReason: r.discrepancyReason ?? null,
      remainingQuantity: Number(r.remainingQuantity) || 0,
      weight: Number(r.weight) || 0,
      volume: Number(r.volume) || 0,
      destination: r.destination ?? null,
      notes: r.notes ?? null,
      performedByUserId:
        r.performedByUserId != null ? Number(r.performedByUserId) : null,
      performedByName: r.performedByName ?? null,
      createdAt: r.createdAt,
    }));
  }

  async submit(id: number): Promise<OrderEntity> {
    const order = await this.findOne(id);
    order.status = 'PENDING_FLEET';
    const saved = await this.orderRepository.save(order);

    // Notify Fleet Manager + Super Admin sau khi submit (non-blocking fire-and-forget)
    setImmediate(() => {
      this.sendOrderPendingFleetNotifications(saved).catch((err) => {
        this.logger.warn(
          'Failed to dispatch order-pending-fleet notification:',
          err,
        );
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
        this.logger.warn(
          'Failed to dispatch order-no-vehicle notification:',
          err,
        );
      });
    });

    return saved;
  }

  async remove(id: number, user?: UserEntity): Promise<void> {
    const order = await this.findOne(id);
    if (user && user.role?.id === RoleEnum.WAREHOUSE_MANAGER) {
      if (order.status !== 'DRAFT') {
        throw new ForbiddenException(
          'Thủ kho chỉ có quyền xóa đơn hàng ở trạng thái Lưu nháp (DRAFT). Đơn hàng đã qua xử lý cần có quyền của Quản trị viên (Admin).',
        );
      }
    }
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
      .replace(/[^A-Z0-9]/gi, '') // chỉ giữ alphanumeric
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
      if (!row.orderCode.toUpperCase().startsWith(prefixDate.toUpperCase()))
        continue;
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

    const qtyStr = order.totalQuantity
      ? ` | SL: ${order.totalQuantity.toLocaleString()} kiện`
      : '';
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
        this.logger.log(
          `[4] In-app notification created for userId=${user.id}`,
        );
      } catch (e) {
        this.logger.error(
          `[4] In-app notification FAILED for userId=${user.id}: ${(e as Error).message}`,
        );
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
          this.logger.error(
            `[6] ❌ Email FAILED to ${user.email}: ${(e as Error).message}`,
            (e as Error).stack,
          );
        }
      } else {
        this.logger.warn(
          `[5] Skipping email — user id=${user.id} has no email`,
        );
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
      reason?.trim() ||
      'Hết phương tiện nội bộ khả dụng tại thời điểm điều phối';

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
        this.logger.log(
          `[4] In-app notification created for userId=${user.id}`,
        );
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
        this.logger.warn(
          `[5] Skipping email — user id=${user.id} has no email`,
        );
      }
    }

    this.logger.log(`[7] sendOrderNoVehicleNotifications DONE`);
  }
}
