import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  DataSource,
  In,
  IsNull,
  EntityManager,
  SelectQueryBuilder,
  Brackets,
} from 'typeorm';
import { OrderEntity } from './infrastructure/persistence/relational/entities/order.entity';
import { HubEntity } from '../hubs/infrastructure/persistence/relational/entities/hub.entity';
import { UserEntity } from '../users/infrastructure/persistence/relational/entities/user.entity';
import { TripEntity } from '../trips/infrastructure/persistence/relational/entities/trip.entity';
import {
  TripStopEntity,
  TripStopStatus,
  TripStopType,
} from '../trips/infrastructure/persistence/relational/entities/trip-stop.entity';
import {
  OrderInventoryTransactionEntity,
  InventoryTransactionType,
} from './infrastructure/persistence/relational/entities/order-inventory-transaction.entity';
import { OrderCodeService } from './order-code.service';
import { OrderActivityAction } from './infrastructure/persistence/relational/entities/order-activity-log.entity';
import { OrderActivityLogService } from './order-activity-log.service';
import {
  DRAFT_LIKE_STATUSES,
  OperationalLedgerService,
} from './operational-ledger.service';
import { RoleEnum } from '../roles/roles.enum';
import {
  QuickCreateInboundOrderDto,
  BatchQuickCreateInboundDto,
} from './dto/quick-create-inbound-order.dto';
import {
  AppendOrderToTripDto,
  AppendOrderMode,
} from './dto/append-order-to-trip.dto';
import { AppendStoredOrdersDto } from './dto/append-stored-orders.dto';
import { ConfirmOutboundDto, OutboundMode } from './dto/confirm-outbound.dto';
import {
  UpdateTripOrderDestinationDto,
  DeliveryModeEnum,
} from './dto/update-trip-order-destination.dto';

export interface WarehouseOrdersResult {
  data: Array<
    OrderEntity & {
      inboundDate?: string | null;
      outboundDate?: string | null;
      inboundTripCode?: string | null;
      inboundLicensePlate?: string | null;
      inboundDriverName?: string | null;
      inboundTripDisplay?: string | null;
      outboundTripCode?: string | null;
      outboundLicensePlate?: string | null;
      outboundDriverName?: string | null;
      outboundTripDisplay?: string | null;
      storageDays?: number;
      [key: string]: any;
    }
  >;
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    totalQuantity: number;
    totalWeight: number;
    totalVolume: number;
    allCount?: number;
    storedCount?: number;
    draftCount?: number;
    dispatchedCount?: number;
    inboundTotal?: number;
    outboundTotal?: number;
  };
}

/** Status groups used by warehouse tabs & KPI cards (values of the hub-scoped status). */
const WAITING_STATUSES = ['DRAFT', 'PENDING', 'PENDING_INBOUND', 'WAITING'];
const STORED_STATUSES = ['INBOUND', 'STORED', 'LUU_KHO', 'IN_WAREHOUSE'];
const DISPATCHED_STATUSES = [
  'COMPLETED_INBOUND',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'COMPLETED_OUTBOUND',
];

const sqlList = (values: string[]) => values.map((v) => `'${v}'`).join(', ');

/** Inbound classification: inter-hub order or transfer transaction / transfer trip. */
const TRANSFER_INBOUND_SQL = `(((order.originHubId IS NOT NULL AND order.destinationHubId IS NOT NULL AND order.originHubId != order.destinationHubId) OR (order.originHub IS NOT NULL AND order.destinationHub IS NOT NULL AND order.originHub != order.destinationHub)) OR EXISTS (SELECT 1 FROM order_inventory_transaction tx WHERE tx."orderId" = order.id AND tx."type" = 'TRANSFER' AND tx."deletedAt" IS NULL) OR EXISTS (SELECT 1 FROM trip t WHERE t."orderId" = order.id AND (t."type" = 'TRANSFER' OR t."notes" ILIKE '%LUÂN CHUYỂN%') AND t."deletedAt" IS NULL))`;
/** Outbound classification: inter-hub order or transfer transaction / transfer trip. */
const TRANSFER_OUTBOUND_SQL = `(((order.originHubId IS NOT NULL AND order.destinationHubId IS NOT NULL AND order.originHubId != order.destinationHubId) OR (order.originHub IS NOT NULL AND order.destinationHub IS NOT NULL AND order.originHub != order.destinationHub)) OR EXISTS (SELECT 1 FROM order_inventory_transaction tx WHERE tx."orderId" = order.id AND tx."type" = 'TRANSFER' AND tx."deletedAt" IS NULL) OR EXISTS (SELECT 1 FROM trip t WHERE t."orderId" = order.id AND (t."type" = 'TRANSFER' OR t."notes" ILIKE '%LUÂN CHUYỂN%') AND t."deletedAt" IS NULL))`;

const isPlaceholderCode = (code?: string | null) =>
  !code || code === '(Tự sinh khi lưu)' || code.startsWith('(Tự sinh');

const normalizeTripCode = (code?: string | null) => {
  const c = (code || '').trim();
  return c && c !== '—' ? c : '';
};

@Injectable()
export class WarehouseService {
  private readonly logger = new Logger(WarehouseService.name);

  constructor(
    @InjectRepository(OrderEntity)
    private readonly orderRepository: Repository<OrderEntity>,
    @InjectRepository(HubEntity)
    private readonly hubRepository: Repository<HubEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(TripEntity)
    private readonly tripRepository: Repository<TripEntity>,
    @InjectRepository(OrderInventoryTransactionEntity)
    private readonly transactionRepository: Repository<OrderInventoryTransactionEntity>,
    private readonly orderCodeService: OrderCodeService,
    private readonly ledgerService: OperationalLedgerService,
    private readonly activityLogService: OrderActivityLogService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Helper to resolve hubId from user entity or DB when missing on JWT payload.
   */
  private async resolveUserHubId(
    user: UserEntity,
  ): Promise<number | null | undefined> {
    if (user.hubId) return user.hubId;
    if (!user.id) return undefined;
    const dbUser = await this.userRepository.findOne({
      where: { id: user.id },
      select: ['id', 'hubId'],
    });
    return dbUser?.hubId ?? null;
  }

  /** Hub-scoped status context applies to Warehouse Managers assigned to a hub. */
  private async resolveHubContext(
    user: UserEntity,
  ): Promise<{ userHubId: number | null; useHubContext: boolean }> {
    const userHubId = (await this.resolveUserHubId(user)) ?? null;
    const useHubContext =
      user.role?.id === RoleEnum.WAREHOUSE_MANAGER && !!userHubId;
    return { userHubId, useHubContext };
  }

  /** Proportional share of a contract metric for a partial quantity. */
  private proportional(
    total: number | null | undefined,
    qty: number,
    totalQty: number | null | undefined,
  ): number {
    const t = Number(total) || 0;
    const tq = Number(totalQty) || 0;
    if (!tq || qty >= tq) return t;
    return Math.round(((t * qty) / tq) * 1000) / 1000;
  }

  /**
   * Hub-scoped status & stock for a set of orders as seen by a hub.
   */
  private async computeHubView(
    orderIds: number[],
    hubId: number,
  ): Promise<
    Map<
      number,
      {
        hubStatus: string;
        hubStock: number;
        pendingOutboundQuantity: number;
        pendingOutboundTripCodes: string[];
        effectiveHubStock: number;
      }
    >
  > {
    const map = new Map<
      number,
      {
        hubStatus: string;
        hubStock: number;
        pendingOutboundQuantity: number;
        pendingOutboundTripCodes: string[];
        effectiveHubStock: number;
      }
    >();
    if (orderIds.length === 0) return map;
    const [rows, pendingAllocMap] = await Promise.all([
      this.orderRepository
        .createQueryBuilder('order')
        .select('order.id', 'id')
        .addSelect(this.ledgerService.hubStatusSql(), 'hubStatus')
        .addSelect(this.ledgerService.hubStockSql(), 'hubStock')
        .where('order.id IN (:...orderIds)', { orderIds })
        .setParameter('userHubId', hubId)
        .getRawMany(),
      this.ledgerService.getBatchPendingOutboundAllocations(orderIds, hubId),
    ]);
    for (const r of rows) {
      const id = Number(r.id);
      const hubStock = Number(r.hubStock) || 0;
      const pendingAlloc = pendingAllocMap.get(id);
      const pendingOutboundQuantity = pendingAlloc?.pendingQty ?? 0;
      const pendingOutboundTripCodes = pendingAlloc?.tripCodes ?? [];
      const effectiveHubStock = Math.max(0, hubStock - pendingOutboundQuantity);
      map.set(id, {
        hubStatus: r.hubStatus,
        hubStock,
        pendingOutboundQuantity,
        pendingOutboundTripCodes,
        effectiveHubStock,
      });
    }
    return map;
  }

  /**
   * List or Lookup warehouse orders with Freetext Search, Status Filter & Pagination.
   * Strict Hub Scoping for WAREHOUSE_MANAGER; statuses are resolved from the manager's hub
   * perspective (Context-Aware status: Chờ nhập kho / Lưu kho / Đã xuất kho).
   */
  async getOrders(
    user: UserEntity,
    query: {
      search?: string;
      status?: string;
      /**
       * INBOUND / OUTBOUND: board views.
       * OUTBOUND_LOOKUP: rows selectable on an outbound note — stock held at the viewer hub
       * (Lưu kho) or a local draft; never goods still on the way or already dispatched.
       */
      flow?: 'INBOUND' | 'OUTBOUND' | 'OUTBOUND_LOOKUP';
      page?: number;
      limit?: number;
      fromDate?: string;
      toDate?: string;
      /** Comma-separated order ids (e.g. refresh metrics of rows already on a note). */
      ids?: string;
      /** `orderCode`: one row per order code with aggregated metrics (Đơn hàng kho). */
      groupBy?: string;
      /** Export mode flag: bypasses the 100-row pagination limit to extract all stored orders. */
      isExport?: string | boolean;
    },
  ): Promise<WarehouseOrdersResult> {
    const isExport =
      query?.isExport === true ||
      query?.isExport === 'true' ||
      query?.isExport === '1';

    const page = isExport ? 1 : Math.max(1, Number(query?.page) || 1);
    const limit = isExport
      ? Math.max(1, Number(query?.limit) || 5000)
      : Math.max(1, Math.min(100, Number(query?.limit) || 20));
    const skip = isExport ? 0 : (page - 1) * limit;

    const { userHubId, useHubContext } = await this.resolveHubContext(user);
    const statusExpr = useHubContext
      ? this.ledgerService.hubStatusSql()
      : 'order.status';

    const flowUpper = query?.flow?.toUpperCase();
    const isAllStatus = !query?.status || query.status.toUpperCase() === 'ALL';
    const searchTerm = query?.search?.trim()
      ? `%${query.search.trim()}%`
      : null;
    const idFilter = (query?.ids || '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
    const groupByOrderCode =
      query?.groupBy === 'orderCode' || flowUpper === 'OUTBOUND_LOOKUP';
    const waitingOrStored = sqlList([...WAITING_STATUSES, ...STORED_STATUSES]);
    const storedOrDispatched = sqlList([
      ...STORED_STATUSES,
      ...DISPATCHED_STATUSES,
    ]);

    /**
     * Filters shared by the list, group and counter queries (everything except the status tab),
     * so tab counters always match the rows rendered. Needs alias `trips` joined when searching.
     */
    const applyScope = (q: SelectQueryBuilder<OrderEntity>) => {
      if (useHubContext) {
        q.andWhere(this.ledgerService.hubScopeSql()).setParameter(
          'userHubId',
          userHubId,
        );
      }
      if (flowUpper === 'OUTBOUND_LOOKUP') {
        q.andWhere(
          `(${statusExpr} IN (${sqlList(STORED_STATUSES)}) OR (${statusExpr} IN (${sqlList(DRAFT_LIKE_STATUSES)}) AND NOT EXISTS (SELECT 1 FROM "trip" inbt WHERE inbt."orderId" = order.id AND inbt."type" = 'INBOUND' AND inbt."deletedAt" IS NULL)))`,
        );
      } else if (isAllStatus && flowUpper === 'INBOUND') {
        // Only items physically in or inbound to the warehouse (exclude departed ones)
        q.andWhere(`${statusExpr} IN (${waitingOrStored})`);
      } else if (isAllStatus && flowUpper === 'OUTBOUND') {
        q.andWhere(`${statusExpr} IN (${storedOrDispatched})`);
      }
      if (idFilter.length > 0) {
        q.andWhere(
          '(order.id IN (:...idFilter) OR order.orderCode IN (SELECT sub_o."orderCode" FROM "order" sub_o WHERE sub_o.id IN (:...idFilter) AND sub_o."deletedAt" IS NULL))',
          { idFilter },
        );
      }
      if (searchTerm) {
        // Freetext: orderCode OR goodsDescription OR trips.licensePlate OR trips.tripCode
        q.andWhere(
          '(order.orderCode ILIKE :search OR order.goodsDescription ILIKE :search OR trips.licensePlate ILIKE :search OR trips.tripCode ILIKE :search)',
          { search: searchTerm },
        );
      }
      if (query?.fromDate) {
        const from = new Date(`${query.fromDate}T00:00:00`);
        q.andWhere(
          '(order.createdAt >= :fromDate OR order.updatedAt >= :fromDate)',
          {
            fromDate: from.toISOString(),
          },
        );
      }
      if (query?.toDate) {
        const to = new Date(`${query.toDate}T23:59:59.999`);
        q.andWhere(
          '(order.createdAt <= :toDate OR order.updatedAt <= :toDate)',
          {
            toDate: to.toISOString(),
          },
        );
      }
      return q;
    };

    // Status Filter (Standard Uppercase Enum Keys) — applied on the hub-scoped status
    const applyStatusFilter = (q: SelectQueryBuilder<OrderEntity>) => {
      if (isAllStatus) return q;
      const statusUpper = query.status!.toUpperCase();
      switch (statusUpper) {
        case 'INBOUND':
        case 'STORED':
        case 'IN_WAREHOUSE':
        case 'LUU_KHO':
          q.andWhere(`${statusExpr} IN (${sqlList(STORED_STATUSES)})`);
          if (useHubContext) {
            q.andWhere(`${this.ledgerService.hubStockSql()} > 0`);
          } else {
            q.andWhere('COALESCE(order.remainingQuantity, 0) > 0');
          }
          break;
        case 'WAITING':
        case 'DRAFT':
          q.andWhere(`${statusExpr} IN (${sqlList(WAITING_STATUSES)})`);
          break;
        case 'CUSTOMER':
          q.andWhere(
            `${statusExpr} IN (${waitingOrStored}) AND NOT ${TRANSFER_INBOUND_SQL}`,
          );
          break;
        case 'TRANSFER':
          q.andWhere(
            `${statusExpr} IN (${waitingOrStored}) AND ${TRANSFER_INBOUND_SQL}`,
          );
          break;
        case 'COMPLETED_INBOUND':
          q.andWhere(
            `(${statusExpr} IN (${sqlList(DISPATCHED_STATUSES)}) OR ${statusExpr} = 'COMPLETED_INBOUND')`,
          );
          break;
        case 'PENDING_INBOUND':
          q.andWhere(`${statusExpr} IN ('PENDING_INBOUND', 'WAITING')`);
          break;
        default:
          q.andWhere(`${statusExpr} = :st`, { st: query.status });
          break;
      }
      return q;
    };

    const createListQb = () =>
      this.orderRepository
        .createQueryBuilder('order')
        .leftJoinAndSelect('order.originHubEntity', 'originHubEntity')
        .leftJoinAndSelect('order.destinationHubEntity', 'destinationHubEntity')
        .leftJoinAndSelect('order.currentHubEntity', 'currentHubEntity')
        .leftJoinAndSelect('order.trips', 'trips')
        .leftJoinAndSelect('trips.originHub', 'tripOriginHub')
        .leftJoinAndSelect('trips.destinationHub', 'tripDestinationHub')
        .leftJoinAndSelect(
          'order.inventoryTransactions',
          'inventoryTransactions',
        )
        .leftJoinAndSelect(
          'inventoryTransactions.hub',
          'inventoryTransactionHub',
        )
        .where('order.deletedAt IS NULL');

    // Dynamic counts for status tabs based on current hub scope
    const countQb = this.orderRepository
      .createQueryBuilder('order')
      .select('order.id', 'id')
      .addSelect('order.orderCode', 'oc')
      .addSelect(statusExpr, 'hs')
      .addSelect(
        useHubContext
          ? this.ledgerService.hubStockSql()
          : 'COALESCE(order.remainingQuantity, 0)',
        'stock',
      )
      .distinct(true)
      .where('order.deletedAt IS NULL');
    if (searchTerm) countQb.leftJoin('order.trips', 'trips');
    applyScope(countQb);

    const countRows: Array<{
      id: number;
      oc: string;
      hs: string;
      stock: number;
    }> = await countQb.getRawMany();
    // Grouped view counts order codes (a code is in a tab when any of its rows is)
    const bucketCount = (pred: (hs: string, stock: number) => boolean) => {
      const rows = countRows.filter((r) => pred(r.hs, Number(r.stock) || 0));
      return groupByOrderCode
        ? new Set(rows.map((r) => r.oc)).size
        : rows.length;
    };
    const allCount = bucketCount(() => true);
    const storedCount = bucketCount(
      (hs, stock) => STORED_STATUSES.includes(hs) && stock > 0,
    );
    const draftCount = bucketCount((hs) => WAITING_STATUSES.includes(hs));
    const dispatchedCount = bucketCount(
      (hs) => DISPATCHED_STATUSES.includes(hs) || hs === 'COMPLETED_INBOUND',
    );

    if (groupByOrderCode) {
      return this.getOrdersGroupedByCode({
        createListQb,
        applyScope,
        applyStatusFilter,
        searchTerm,
        page,
        limit,
        skip,
        userHubId,
        useHubContext,
        counts: { allCount, storedCount, draftCount, dispatchedCount },
      });
    }

    const qb = applyStatusFilter(applyScope(createListQb()));
    qb.orderBy('order.createdAt', 'DESC');

    const [data, total] = await qb.skip(skip).take(limit).getManyAndCount();

    // Summary totals of current dataset
    const totalQuantity = data.reduce(
      (sum, item) => sum + (Number(item.totalQuantity) || 0),
      0,
    );
    const totalWeight = data.reduce(
      (sum, item) => sum + (Number(item.totalWeight) || 0),
      0,
    );
    const totalVolume = data.reduce(
      (sum, item) => sum + (Number(item.totalVolume) || 0),
      0,
    );

    const enrichedData = await this.enrichWarehouseRows(
      data,
      userHubId,
      useHubContext,
    );

    return {
      data: enrichedData as any,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
        totalQuantity,
        totalWeight,
        totalVolume,
        allCount,
        storedCount,
        draftCount,
        dispatchedCount,
      },
    };
  }

  /** Adds address fallbacks plus hub-scoped status/stock (ledger based) to warehouse rows. */
  private async enrichWarehouseRows(
    data: OrderEntity[],
    userHubId: number | null,
    useHubContext: boolean,
  ): Promise<any[]> {
    const hubView =
      useHubContext && userHubId
        ? await this.computeHubView(
            data.map((d) => d.id),
            userHubId,
          )
        : new Map<
            number,
            {
              hubStatus: string;
              hubStock: number;
              pendingOutboundQuantity: number;
              pendingOutboundTripCodes: string[];
              effectiveHubStock: number;
            }
          >();

    return data.map((item) => {
      let pickupAddr = item.originHub || '';
      let deliveryAddr = '';
      if (item.route && item.route.includes('→')) {
        const parts = item.route.split('→');
        if (!pickupAddr || pickupAddr === 'Hub') {
          pickupAddr = parts[0]?.trim() || '';
        }
        deliveryAddr = parts[1]?.trim() || '';
      }
      const view = hubView.get(item.id);
      const effectiveStatus = view?.hubStatus ?? item.status;
      const effectiveStock =
        view?.effectiveHubStock !== undefined &&
        view?.effectiveHubStock !== null
          ? view.effectiveHubStock
          : view?.hubStock !== undefined && view?.hubStock !== null
            ? view.hubStock
            : item.remainingQuantity !== undefined &&
                item.remainingQuantity !== null
              ? item.remainingQuantity
              : null;

      const txs = (item.inventoryTransactions as any[]) || [];
      const hubTxs = userHubId
        ? txs.filter((t) => !t.hubId || Number(t.hubId) === Number(userHubId))
        : txs;

      const inboundTxs = hubTxs
        .filter((t) => t.type === InventoryTransactionType.INBOUND)
        .sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
      const inboundDate =
        inboundTxs.length > 0 ? inboundTxs[0].createdAt : item.createdAt;

      let inboundTripCode: string | null = null;
      let inboundLicensePlate: string | null = null;
      let inboundDriverName: string | null = null;

      if (inboundTxs.length > 0) {
        inboundTripCode = inboundTxs[0].tripCode || null;
        inboundLicensePlate = inboundTxs[0].licensePlate || null;
        inboundDriverName = inboundTxs[0].driverName || null;
      }
      if (!inboundLicensePlate && (item as any).vehicleLicensePlate) {
        inboundLicensePlate = (item as any).vehicleLicensePlate;
      }
      if (!inboundTripCode && item.currentTripCode) {
        inboundTripCode = item.currentTripCode;
      }
      if (!inboundDriverName && (item as any).driverName) {
        inboundDriverName = (item as any).driverName;
      }
      if (
        !inboundTripCode &&
        !inboundLicensePlate &&
        Array.isArray(item.trips) &&
        item.trips.length > 0
      ) {
        const firstTrip = item.trips[0];
        inboundTripCode = firstTrip.tripCode || null;
        inboundLicensePlate = firstTrip.licensePlate || null;
        inboundDriverName = firstTrip.driverName || null;
      }

      let inboundTripDisplay: string | null = null;
      if (inboundTripCode && inboundLicensePlate) {
        inboundTripDisplay = `${inboundTripCode} (${inboundLicensePlate})`;
      } else if (inboundTripCode) {
        inboundTripDisplay = inboundTripCode;
      } else if (inboundLicensePlate) {
        inboundTripDisplay = inboundLicensePlate;
      }

      // Biển số xe nhập dự kiến (expectedInboundLicensePlate):
      // - Các đơn nháp: biển số xe của trip nhập đơn hàng đang ở trạng thái chờ xử lý (PENDING).
      // - Các đơn đã có trạng thái lưu kho: để trống (null).
      const isStored =
        STORED_STATUSES.includes(effectiveStatus) ||
        STORED_STATUSES.includes(item.status);

      let expectedInboundLicensePlate: string | null = null;
      if (!isStored) {
        const itemTrips = (item.trips as any[]) || [];
        const pendingInboundTrip = itemTrips.find(
          (t) =>
            (t.type === 'INBOUND' ||
              (t.type !== 'OUTBOUND' && t.type !== 'TRANSFER')) &&
            (t.status === 'PENDING' || t.status === 'WAITING') &&
            t.licensePlate,
        );
        if (pendingInboundTrip?.licensePlate) {
          expectedInboundLicensePlate = pendingInboundTrip.licensePlate;
        } else {
          const anyPendingTrip = itemTrips.find(
            (t) =>
              (t.status === 'PENDING' || t.status === 'WAITING') &&
              t.type !== 'OUTBOUND' &&
              t.type !== 'TRANSFER' &&
              t.licensePlate,
          );
          if (anyPendingTrip?.licensePlate) {
            expectedInboundLicensePlate = anyPendingTrip.licensePlate;
          } else if (inboundLicensePlate) {
            expectedInboundLicensePlate = inboundLicensePlate;
          } else if ((item as any).vehicleLicensePlate) {
            expectedInboundLicensePlate = (item as any).vehicleLicensePlate;
          }
        }
      }

      // RÀNG BUỘC SỐNG CÒN: Khi đơn ở trạng thái Lưu kho / Đơn nháp hoặc còn tồn kho > 0,
      // outboundDate, outboundTripCode, outboundLicensePlate, outboundTripDisplay BẮT BUỘC để trống (null)
      const isStoredOrDraft =
        STORED_STATUSES.includes(effectiveStatus) ||
        effectiveStatus === 'DRAFT' ||
        WAITING_STATUSES.includes(effectiveStatus) ||
        (effectiveStock !== null && Number(effectiveStock) > 0);

      let outboundDate: Date | string | null = null;
      let outboundTripCode: string | null = null;
      let outboundLicensePlate: string | null = null;
      let outboundDriverName: string | null = null;
      let outboundTripDisplay: string | null = null;
      let outboundDestination: string | null = null;

      if (!isStoredOrDraft) {
        const outboundTxs = hubTxs
          .filter(
            (t) =>
              t.type === InventoryTransactionType.OUTBOUND ||
              t.type === InventoryTransactionType.TRANSFER,
          )
          .sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          );
        if (outboundTxs.length > 0) {
          outboundDate = outboundTxs[0].createdAt;
          outboundTripCode = outboundTxs[0].tripCode || null;
          outboundLicensePlate = outboundTxs[0].licensePlate || null;
          outboundDriverName = outboundTxs[0].driverName || null;
          outboundDestination = outboundTxs[0].destination || null;
        } else if (
          item.status === 'COMPLETED_INBOUND' ||
          item.status === 'DISPATCHED' ||
          effectiveStatus === 'COMPLETED_INBOUND'
        ) {
          outboundDate = item.updatedAt || null;
          const itemTrips = (item.trips as any[]) || [];
          if (itemTrips.length > 0) {
            const lastTrip = itemTrips[itemTrips.length - 1];
            outboundTripCode = lastTrip.tripCode || null;
            outboundLicensePlate = lastTrip.licensePlate || null;
            outboundDriverName = lastTrip.driverName || null;
            outboundDestination =
              lastTrip.destinationHub?.name ||
              lastTrip.tripDestinationHub?.name ||
              (lastTrip.notes
                ? lastTrip.notes.replace(/^\[.*?\]\s*/, '')
                : null);
          }
        }

        if (outboundTripCode && outboundLicensePlate) {
          outboundTripDisplay = `${outboundTripCode} (${outboundLicensePlate})`;
        } else if (outboundTripCode) {
          outboundTripDisplay = outboundTripCode;
        } else if (outboundLicensePlate) {
          outboundTripDisplay = outboundLicensePlate;
        }
      }

      const inboundTime = inboundDate
        ? new Date(inboundDate).getTime()
        : new Date(item.createdAt).getTime();
      let storageDays = 0;
      if (outboundDate) {
        const outboundTime = new Date(outboundDate).getTime();
        storageDays = Math.max(
          0,
          Math.floor((outboundTime - inboundTime) / (1000 * 60 * 60 * 24)),
        );
      } else {
        storageDays = Math.max(
          0,
          Math.floor((Date.now() - inboundTime) / (1000 * 60 * 60 * 24)),
        );
      }

      const originalDestination =
        item.destinationHub ||
        item.destinationHubEntity?.name ||
        deliveryAddr ||
        item.province ||
        '';

      return {
        ...item,
        pickupAddress: pickupAddr || item.originHubEntity?.name || '',
        deliveryAddress:
          deliveryAddr ||
          item.destinationHub ||
          item.destinationHubEntity?.name ||
          '',
        destinationHub: originalDestination,
        originalDestination,
        outboundDestination,
        /** Status seen from the viewer's hub (falls back to global status). */
        hubStatus: effectiveStatus,
        /** Available stock at the viewer's hub (ledger based); null without hub context. */
        hubStock: view ? view.hubStock : null,
        pendingOutboundQuantity: view ? view.pendingOutboundQuantity : 0,
        pendingOutboundTripCodes: view ? view.pendingOutboundTripCodes : [],
        effectiveHubStock: view ? view.effectiveHubStock : null,
        effectiveStock: effectiveStock,
        isContractLocked: !DRAFT_LIKE_STATUSES.includes(item.status),
        inboundDate: inboundDate ? new Date(inboundDate).toISOString() : null,
        outboundDate: outboundDate
          ? new Date(outboundDate).toISOString()
          : null,
        inboundTripCode,
        inboundLicensePlate,
        inboundDriverName,
        inboundTripDisplay,
        expectedInboundLicensePlate,
        outboundTripCode,
        outboundLicensePlate,
        outboundDriverName,
        outboundTripDisplay,
        storageDays,
      };
    });
  }

  /**
   * "Đơn hàng kho" view: one row per order code. Pagination runs over distinct codes; each code
   * aggregates only its rows matching the active filters. Member rows are returned in `items`.
   */
  private async getOrdersGroupedByCode(ctx: {
    createListQb: () => SelectQueryBuilder<OrderEntity>;
    applyScope: (
      q: SelectQueryBuilder<OrderEntity>,
    ) => SelectQueryBuilder<OrderEntity>;
    applyStatusFilter: (
      q: SelectQueryBuilder<OrderEntity>,
    ) => SelectQueryBuilder<OrderEntity>;
    searchTerm: string | null;
    page: number;
    limit: number;
    skip: number;
    userHubId: number | null;
    useHubContext: boolean;
    counts: {
      allCount: number;
      storedCount: number;
      draftCount: number;
      dispatchedCount?: number;
    };
  }): Promise<WarehouseOrdersResult> {
    const groupQb = this.orderRepository
      .createQueryBuilder('order')
      .where('order.deletedAt IS NULL');
    if (ctx.searchTerm) groupQb.leftJoin('order.trips', 'trips');
    ctx.applyStatusFilter(ctx.applyScope(groupQb));

    const totalRow = await groupQb
      .clone()
      .select('COUNT(DISTINCT order.orderCode)', 'cnt')
      .getRawOne<{ cnt: string }>();
    const total = Number(totalRow?.cnt) || 0;

    const codeRows = await groupQb
      .select('order.orderCode', 'orderCode')
      .addSelect('MAX(order.createdAt)', 'lastAt')
      .groupBy('order.orderCode')
      .orderBy('"lastAt"', 'DESC')
      .offset(ctx.skip)
      .limit(ctx.limit)
      .getRawMany<{ orderCode: string }>();
    const codes = codeRows.map((r) => r.orderCode);

    let members: OrderEntity[] = [];
    if (codes.length > 0) {
      members = await ctx
        .applyStatusFilter(ctx.applyScope(ctx.createListQb()))
        .andWhere('order.orderCode IN (:...groupCodes)', { groupCodes: codes })
        .orderBy('order.id', 'ASC')
        .getMany();
    }
    const enriched = await this.enrichWarehouseRows(
      members,
      ctx.userHubId,
      ctx.useHubContext,
    );

    const byCode = new Map<string, any[]>();
    for (const row of enriched) {
      const list = byCode.get(row.orderCode) ?? [];
      list.push(row);
      byCode.set(row.orderCode, list);
    }
    const grouped = codes
      .filter((code) => byCode.has(code))
      .map((code) => this.aggregateOrderGroup(code, byCode.get(code)!));

    const sum = (pick: (g: any) => unknown) =>
      grouped.reduce((s, g) => s + (Number(pick(g)) || 0), 0);

    return {
      data: grouped as any,
      meta: {
        total,
        page: ctx.page,
        limit: ctx.limit,
        totalPages: Math.ceil(total / ctx.limit) || 1,
        totalQuantity: sum((g) => g.totalQuantity),
        totalWeight: sum((g) => g.totalWeight),
        totalVolume: sum((g) => g.totalVolume),
        ...ctx.counts,
      },
    };
  }

  /** Collapse the rows sharing one order code into a single summary row. */
  private aggregateOrderGroup(orderCode: string, items: any[]): any {
    const first = items[0];
    const isDraftItem = (it: any) =>
      DRAFT_LIKE_STATUSES.includes(
        String(it.hubStatus ?? it.status ?? '').toUpperCase(),
      );
    const nonDraftItems = items.filter((it) => !isDraftItem(it));
    // When an orderCode already has real inbound/dispatched rows, ignore leftover draft rows in metric sums
    const metricItems = nonDraftItems.length > 0 ? nonDraftItems : items;
    const primaryRow =
      metricItems.find(
        (it) => (Number(it.hubStock ?? it.remainingQuantity) || 0) > 0,
      ) ||
      metricItems[0] ||
      first;

    const sum = (pick: (it: any) => unknown) =>
      metricItems.reduce((s, it) => s + (Number(pick(it)) || 0), 0);
    const round3 = (n: number) => Math.round(n * 1000) / 1000;
    const distinctJoin = (pick: (it: any) => string | null | undefined) =>
      Array.from(
        new Set(
          items
            .map(pick)
            .map((v) => v?.trim())
            .filter(Boolean),
        ),
      ).join(', ');

    // A code is "Lưu kho" while any row is still held here; "Đã xuất kho" only when none is.
    const statuses: string[] = metricItems.map(
      (it) => it.hubStatus ?? it.status,
    );
    const hubStatus =
      statuses.find((s) => STORED_STATUSES.includes(s)) ??
      statuses.find((s) => s === 'DRAFT') ??
      statuses.find((s) => WAITING_STATUSES.includes(s)) ??
      statuses[0];

    const tripMap = new Map<string, any>();
    for (const it of items) {
      for (const t of it.trips ?? []) {
        const key = t.tripCode || t.licensePlate || `id-${t.id}`;
        if (!tripMap.has(key)) tripMap.set(key, t);
      }
      if (it.vehicleLicensePlate && !tripMap.has(it.vehicleLicensePlate)) {
        tripMap.set(it.vehicleLicensePlate, {
          tripCode: it.currentTripCode || null,
          licensePlate: it.vehicleLicensePlate,
          driverName: it.driverName || null,
        });
      }
      for (const tx of it.inventoryTransactions ?? []) {
        if (tx.licensePlate) {
          const key = tx.tripCode || tx.licensePlate;
          if (!tripMap.has(key)) {
            tripMap.set(key, {
              tripCode: tx.tripCode || null,
              licensePlate: tx.licensePlate,
              driverName: tx.driverName || null,
            });
          }
        }
      }
    }
    const trips = Array.from(tripMap.values()).sort(
      (a, b) => (b.id ?? 0) - (a.id ?? 0),
    );

    const allTransactions = items.flatMap(
      (it) => it.inventoryTransactions ?? [],
    );

    const hasHubStock = metricItems.some(
      (it) => it.hubStock !== null && it.hubStock !== undefined,
    );
    const rawStock = hasHubStock
      ? sum((it) => it.hubStock)
      : sum((it) => it.remainingQuantity);
    const totalInbound = sum((it) => it.inboundQuantity || 0);
    const totalOutbound = sum((it) => it.outboundQuantity || 0);
    const rawTotalQty = sum((it) => it.totalQuantity);

    // Standardize ratio: total packages must at least cover total received and active stock
    const normalizedTotalQty = Math.max(rawTotalQty, totalInbound, rawStock);
    const normalizedHubStock = hasHubStock
      ? Math.max(0, Math.min(rawStock, normalizedTotalQty))
      : null;

    const totalPendingOutbound = sum((it) => it.pendingOutboundQuantity || 0);
    const pendingOutboundTripCodes = Array.from(
      new Set(metricItems.flatMap((it) => it.pendingOutboundTripCodes || [])),
    );
    const effectiveHubStock =
      normalizedHubStock !== null
        ? Math.max(0, normalizedHubStock - totalPendingOutbound)
        : null;

    // Normalize member items so each individual line also satisfies stock <= total quantity
    const normalizedItems = metricItems.map((it) => {
      const itStock =
        it.hubStock !== null && it.hubStock !== undefined
          ? Number(it.hubStock)
          : Number(it.remainingQuantity) || 0;
      const itInbound = Number(it.inboundQuantity) || 0;
      const itTotal = Math.max(
        Number(it.totalQuantity) || 0,
        itInbound,
        itStock,
      );
      return {
        ...it,
        totalQuantity: itTotal,
        hubStock:
          it.hubStock !== null && it.hubStock !== undefined
            ? Math.max(0, Math.min(itStock, itTotal))
            : null,
      };
    });

    const isStoredOrDraftGroup =
      STORED_STATUSES.includes(hubStatus) ||
      hubStatus === 'DRAFT' ||
      WAITING_STATUSES.includes(hubStatus) ||
      (normalizedHubStock !== null && normalizedHubStock > 0);

    const validInboundDates = normalizedItems
      .map((it) => it.inboundDate)
      .filter(Boolean)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
    const groupInboundDate =
      validInboundDates.length > 0 ? validInboundDates[0] : first.createdAt;

    const groupInboundTripDisplay =
      normalizedItems.find((it) => it.inboundTripDisplay)?.inboundTripDisplay ||
      first.inboundTripDisplay ||
      null;
    const groupInboundTripCode =
      normalizedItems.find((it) => it.inboundTripCode)?.inboundTripCode ||
      first.inboundTripCode ||
      null;
    const groupInboundLicensePlate =
      normalizedItems.find((it) => it.inboundLicensePlate)
        ?.inboundLicensePlate ||
      first.inboundLicensePlate ||
      null;
    const groupInboundDriverName =
      normalizedItems.find((it) => it.inboundDriverName)?.inboundDriverName ||
      first.inboundDriverName ||
      null;

    let groupOutboundDate: string | null = null;
    let groupOutboundTripDisplay: string | null = null;
    let groupOutboundTripCode: string | null = null;
    let groupOutboundLicensePlate: string | null = null;
    let groupOutboundDriverName: string | null = null;

    if (!isStoredOrDraftGroup) {
      const validOutboundDates = normalizedItems
        .map((it) => it.outboundDate)
        .filter(Boolean)
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
      groupOutboundDate =
        validOutboundDates.length > 0 ? validOutboundDates[0] : null;

      groupOutboundTripDisplay =
        normalizedItems.find((it) => it.outboundTripDisplay)
          ?.outboundTripDisplay || null;
      groupOutboundTripCode =
        normalizedItems.find((it) => it.outboundTripCode)?.outboundTripCode ||
        null;
      groupOutboundLicensePlate =
        normalizedItems.find((it) => it.outboundLicensePlate)
          ?.outboundLicensePlate || null;
      groupOutboundDriverName =
        normalizedItems.find((it) => it.outboundDriverName)
          ?.outboundDriverName || null;
    }

    const grpInboundTime = groupInboundDate
      ? new Date(groupInboundDate).getTime()
      : new Date(first.createdAt).getTime();
    let groupStorageDays = 0;
    if (groupOutboundDate) {
      const grpOutboundTime = new Date(groupOutboundDate).getTime();
      groupStorageDays = Math.max(
        0,
        Math.floor((grpOutboundTime - grpInboundTime) / (1000 * 60 * 60 * 24)),
      );
    } else {
      groupStorageDays = Math.max(
        0,
        Math.floor((Date.now() - grpInboundTime) / (1000 * 60 * 60 * 24)),
      );
    }

    // Canonical Master Fields: Strictly use the FIRST entry's goodsDescription and destination
    const canonicalGoodsDescription =
      first.goodsDescription?.trim() ||
      items
        .find((it) => it.goodsDescription?.trim())
        ?.goodsDescription?.trim() ||
      'Hàng tổng hợp';
    const groupOriginalDestination =
      first.originalDestination?.trim() ||
      first.destinationHub?.trim() ||
      first.destinationHubEntity?.name?.trim() ||
      items.find(
        (it) =>
          it.originalDestination?.trim() ||
          it.destinationHub?.trim() ||
          it.destinationHubEntity?.name?.trim(),
      )?.originalDestination ||
      null;
    const groupOutboundDestination =
      distinctJoin((it) => it.outboundDestination) || null;

    return {
      ...first,
      id: primaryRow.id,
      orderCode,
      goodsDescription: canonicalGoodsDescription,
      totalQuantity: normalizedTotalQty,
      inboundQuantity: Math.max(totalInbound, normalizedTotalQty),
      outboundQuantity: totalOutbound,
      remainingQuantity:
        normalizedHubStock ?? Math.max(0, normalizedTotalQty - totalOutbound),
      totalWeight: round3(sum((it) => it.totalWeight)),
      totalVolume: round3(sum((it) => it.totalVolume)),
      hubStock: normalizedHubStock,
      pendingOutboundQuantity: totalPendingOutbound,
      pendingOutboundTripCodes,
      effectiveHubStock,
      hubStatus,
      destinationHub: groupOriginalDestination,
      originalDestination: groupOriginalDestination,
      outboundDestination: groupOutboundDestination,
      trips,
      inventoryTransactions: allTransactions,
      lineCount: 1,
      items: normalizedItems,
      inboundDate: groupInboundDate
        ? new Date(groupInboundDate).toISOString()
        : null,
      outboundDate: groupOutboundDate
        ? new Date(groupOutboundDate).toISOString()
        : null,
      inboundTripCode: groupInboundTripCode,
      inboundLicensePlate: groupInboundLicensePlate,
      inboundDriverName: groupInboundDriverName,
      inboundTripDisplay: groupInboundTripDisplay,
      outboundTripCode: groupOutboundTripCode,
      outboundLicensePlate: groupOutboundLicensePlate,
      outboundDriverName: groupOutboundDriverName,
      outboundTripDisplay: groupOutboundTripDisplay,
      storageDays: groupStorageDays,
    };
  }

  /**
   * Allocate the canonical short trip code: SD1, SD2, ... (global sequence `trip_code_sd_seq`).
   */
  async generateTripCode(manager?: EntityManager): Promise<string> {
    return this.ledgerService.generateTripCode(manager);
  }

  private async loadUserWithHub(user: UserEntity): Promise<UserEntity> {
    const userWithHub = await this.userRepository.findOne({
      where: { id: user.id },
      relations: ['hub', 'role'],
    });
    if (!userWithHub) {
      throw new UnauthorizedException(
        'Tài khoản không tồn tại trên hệ thống hoặc phiên đăng nhập đã cũ. Vui lòng đăng nhập lại.',
      );
    }
    return userWithHub;
  }

  /**
   * Kiểm tra quyền chỉnh sửa hoặc thao tác trên chuyến xe theo trạng thái trạm dừng.
   * Nếu trạm dừng tại Hub đang thao tác đã ở trạng thái COMPLETED:
   * - Tài khoản thuộc Hub (Non-admin) bị cấm (ném ForbiddenException).
   * - Tài khoản SUPER_ADMIN được phép can thiệp đặc quyền.
   */
  async validateTripStopEditPermission(
    user: UserEntity,
    tripCode: string,
    targetHubId?: number,
    actionName: string = 'thao tác',
  ): Promise<{ isCompleted: boolean; isAdmin: boolean }> {
    const userWithHub = await this.userRepository.findOne({
      where: { id: user.id },
      relations: ['hub', 'role'],
    });
    const roleId = Number(
      userWithHub?.role?.id ?? user.role?.id ?? (user.role as any),
    );
    const roleName =
      userWithHub?.role?.name ||
      (typeof user.role === 'string' ? user.role : (user.role as any)?.name) ||
      '';
    const isAdmin =
      roleId === RoleEnum.SUPER_ADMIN ||
      roleName === 'SUPER_ADMIN' ||
      (user.role as any) === 'SUPER_ADMIN';

    const operatingHubId =
      targetHubId ?? userWithHub?.hubId ?? user.hubId ?? null;
    const normTripCode = normalizeTripCode(tripCode);

    if (normTripCode && operatingHubId) {
      const tripStopRepo = this.dataSource.getRepository(TripStopEntity);
      const stop = await tripStopRepo.findOne({
        where: { tripCode: normTripCode, hubId: operatingHubId },
        relations: ['hub'],
      });

      if (stop && stop.status === TripStopStatus.COMPLETED) {
        if (!isAdmin) {
          const hubName =
            stop.hub?.name ||
            userWithHub?.hub?.name ||
            `Hub #${operatingHubId}`;
          throw new ForbiddenException(
            `Chuyến xe ${normTripCode} đã ở trạng thái Đã xử lý tại trạm ${hubName}. Tài khoản của Hub không có quyền ${actionName}. Chỉ tài khoản Quản trị viên (Admin) mới có quyền chỉnh sửa khi chuyến xe đã xử lý.`,
          );
        }
        this.logger.log(
          `[ADMIN OVERRIDE] Quản trị viên ${user.id} (${user.email || 'Admin'}) thực hiện ${actionName} trên chuyến xe ${normTripCode} đã xử lý tại trạm ${stop.hub?.name || operatingHubId}`,
        );
        return { isCompleted: true, isAdmin: true };
      }
    }

    return { isCompleted: false, isAdmin };
  }

  /**
   * Quick create inbound order row from warehouse.
   * Generates code atomically via OrderCodeService, sets status = 'INBOUND' (LƯU KHO).
   * Creates the Master Contract + (when not a draft) the first Inbound Receipt invoice.
   * Automatically creates TripEntity with SD trip code, licensePlate, driverName and the hub stop.
   */
  async quickCreateInboundOrder(
    user: UserEntity,
    dto: QuickCreateInboundOrderDto,
  ): Promise<OrderEntity> {
    const userWithHub = await this.loadUserWithHub(user);

    return this.dataSource.transaction(async (manager) => {
      const orderRepo = manager.getRepository(OrderEntity);
      const tripRepo = manager.getRepository(TripEntity);
      const txRepo = manager.getRepository(OrderInventoryTransactionEntity);
      const hubRepo = manager.getRepository(HubEntity);

      // Check if client provided custom orderCode
      let finalOrderCode = dto.orderCode?.trim();
      if (isPlaceholderCode(finalOrderCode)) {
        // Server generates canonical orderCode atomically
        finalOrderCode = await this.orderCodeService.generateOrderCode(
          userWithHub,
          manager,
        );
      }

      let destinationHubName: string | null = null;
      if (dto.destinationHubId) {
        const destHub = await hubRepo.findOne({
          where: { id: dto.destinationHubId },
        });
        if (destHub) {
          destinationHubName = destHub.name;
        }
      }

      const originHubId = userWithHub.hubId || null;
      const originHubName = userWithHub.hub?.name || null;

      const initialStatus = dto.initialStatus || 'INBOUND'; // LƯU KHO
      const isDraft = DRAFT_LIKE_STATUSES.includes(initialStatus);

      const finalGoodsDescription =
        dto.goodsDescription?.trim() ||
        (isDraft ? 'Hàng lưu kho (Nháp)' : 'Hàng hóa');

      const finalQuantity =
        dto.totalQuantity !== undefined && Number(dto.totalQuantity) > 0
          ? Number(dto.totalQuantity)
          : 1;

      const finalWeight =
        dto.totalWeight !== undefined && Number(dto.totalWeight) >= 0
          ? Number(dto.totalWeight)
          : 0;

      const finalVolume =
        dto.totalVolume !== undefined && Number(dto.totalVolume) >= 0
          ? Number(dto.totalVolume)
          : 0;

      const plate = dto.licensePlate?.trim().toUpperCase();
      const driver = dto.driverName?.trim() || null;
      const date =
        dto.receiveDate?.trim() || new Date().toISOString().split('T')[0];

      const pickupAddr = dto.pickupAddress?.trim() || originHubName || 'Hub';
      const deliveryAddr =
        dto.deliveryAddress?.trim() || destinationHubName || 'Điểm đến';

      const finalTripCode = plate
        ? normalizeTripCode(dto.tripCode) ||
          (await this.ledgerService.generateTripCode(manager))
        : null;

      const existingOrders = finalOrderCode
        ? await orderRepo.find({
            where: { orderCode: finalOrderCode },
            order: { id: 'ASC' },
          })
        : [];

      let savedOrder: OrderEntity;
      let effectiveDeliveryAddr = deliveryAddr;
      let effectiveDestHubId = dto.destinationHubId || null;

      if (existingOrders.length > 0) {
        const firstEntry = existingOrders[0];
        let activeEntry =
          existingOrders.find((o) => !DRAFT_LIKE_STATUSES.includes(o.status)) ||
          firstEntry;
        if (existingOrders.length > 1) {
          activeEntry = await this.consolidateSiblingOrdersByCode(
            manager,
            activeEntry,
          );
        }

        const lockedGoodsDesc =
          firstEntry.goodsDescription || finalGoodsDescription;
        const lockedDestHubName =
          firstEntry.destinationHub || destinationHubName;
        const lockedDestHubId =
          firstEntry.destinationHubId ?? (dto.destinationHubId || null);
        const lockedProvince =
          firstEntry.province || dto.province?.trim() || null;
        const lockedAccompanyingDocs =
          firstEntry.accompanyingDocs || dto.accompanyingDocs?.trim() || null;
        const lockedDeliveryAddr =
          (firstEntry.route && firstEntry.route.includes('→')
            ? firstEntry.route.split('→')[1]?.trim()
            : '') ||
          lockedDestHubName ||
          deliveryAddr;

        effectiveDeliveryAddr = lockedDeliveryAddr;
        effectiveDestHubId = lockedDestHubId;

        const wasDraft = DRAFT_LIKE_STATUSES.includes(activeEntry.status);
        if (wasDraft && !isDraft) {
          activeEntry.totalQuantity = finalQuantity;
          activeEntry.inboundQuantity = finalQuantity;
          activeEntry.remainingQuantity = finalQuantity;
          activeEntry.totalWeight = finalWeight;
          activeEntry.totalVolume = finalVolume;
          activeEntry.status = initialStatus;
          activeEntry.currentHubId = originHubId;
        } else {
          activeEntry.totalQuantity =
            (Number(activeEntry.totalQuantity) || 0) + finalQuantity;
          activeEntry.inboundQuantity =
            (Number(activeEntry.inboundQuantity) || 0) + finalQuantity;
          activeEntry.remainingQuantity =
            (Number(activeEntry.remainingQuantity) || 0) + finalQuantity;
          activeEntry.totalWeight =
            Math.round(
              ((Number(activeEntry.totalWeight) || 0) + finalWeight) * 1000,
            ) / 1000;
          activeEntry.totalVolume =
            Math.round(
              ((Number(activeEntry.totalVolume) || 0) + finalVolume) * 1000,
            ) / 1000;
          if (!isDraft) {
            activeEntry.status = 'INBOUND';
            activeEntry.currentHubId = originHubId;
          }
        }

        activeEntry.goodsDescription = lockedGoodsDesc;
        activeEntry.destinationHub = lockedDestHubName;
        activeEntry.destinationHubId = lockedDestHubId;
        activeEntry.province = lockedProvince;
        activeEntry.accompanyingDocs = lockedAccompanyingDocs;
        activeEntry.originHub =
          dto.pickupAddress?.trim() || activeEntry.originHub || originHubName;
        activeEntry.route = `${pickupAddr} → ${lockedDeliveryAddr}`;
        if (dto.notes?.trim()) {
          activeEntry.notes = dto.notes.trim();
        }

        savedOrder = await orderRepo.save(activeEntry);
      } else {
        const order = orderRepo.create({
          orderCode: finalOrderCode,
          goodsDescription: finalGoodsDescription,
          totalQuantity: finalQuantity,
          inboundQuantity: finalQuantity,
          outboundQuantity: 0,
          remainingQuantity: finalQuantity,
          totalWeight: finalWeight,
          totalVolume: finalVolume,
          route: `${pickupAddr} → ${deliveryAddr}`,
          originHub: dto.pickupAddress?.trim() || originHubName,
          originHubId,
          currentHubId: originHubId,
          destinationHub: destinationHubName,
          destinationHubId: dto.destinationHubId || null,
          province: dto.province?.trim() || null,
          accompanyingDocs: dto.accompanyingDocs?.trim() || null,
          notes: dto.notes?.trim() || null,
          status: initialStatus,
          createdByUserId: user.id,
          isExternalVehicleNeeded: false,
        });

        savedOrder = await orderRepo.save(order);
      }

      // Create TripEntity for vehicle intake
      let savedTrip: TripEntity | null = null;
      if (plate && finalTripCode) {
        savedTrip = await tripRepo.save(
          tripRepo.create({
            orderId: savedOrder.id,
            tripCode: finalTripCode,
            originHubId,
            destinationHubId: effectiveDestHubId,
            type: 'INBOUND',
            licensePlate: plate,
            driverName: driver,
            status: isDraft ? 'PENDING' : 'COMPLETED',
            pickupDate: date,
            quantityAllocated: finalQuantity,
            weightAllocated: finalWeight,
            volumeAllocated: finalVolume,
            notes: `[NHẬP KHO] Xe ${plate} tiếp nhận ${finalQuantity} kiện tại ${originHubName || 'Kho'}`,
          }),
        );
        savedOrder.trips = [savedTrip];

        if (originHubId) {
          await this.ledgerService.upsertTripStop(
            {
              tripCode: finalTripCode,
              hubId: originHubId,
              status: isDraft
                ? TripStopStatus.PENDING
                : TripStopStatus.COMPLETED,
              stopType: TripStopType.DESTINATION,
              stopSequence: 1,
              userId: user.id,
            },
            manager,
          );
        }
      }

      // Initial Inbound Receipt invoice — drafts are not in stock yet.
      if (!isDraft) {
        const invoiceCode = await this.ledgerService.generateInvoiceCode(
          InventoryTransactionType.INBOUND,
          originHubId,
          manager,
        );
        await txRepo.save(
          txRepo.create({
            orderId: savedOrder.id,
            type: InventoryTransactionType.INBOUND,
            invoiceCode,
            hubId: originHubId,
            tripId: savedTrip?.id ?? null,
            tripCode: finalTripCode,
            quantity: finalQuantity,
            expectedQuantity: finalQuantity,
            discrepancyQuantity: 0,
            remainingQuantity: savedOrder.remainingQuantity,
            weight: finalWeight,
            volume: finalVolume,
            licensePlate: plate || null,
            driverName: driver || null,
            notes: dto.notes?.trim() || 'Tiếp nhận nhập kho ban đầu',
            destination: effectiveDeliveryAddr || null,
            performedByUserId: user.id,
          }),
        );
      }

      return savedOrder;
    });
  }

  /**
   * Batch create inbound orders for a single vehicle trip.
   * Generates ONE shared SD trip code, creates OrderEntity and TripEntity for each item,
   * one shared Inbound Receipt invoice code and the hub stop.
   */
  async batchCreateInboundOrders(
    user: UserEntity,
    dto: BatchQuickCreateInboundDto,
  ): Promise<{
    tripCode: string;
    licensePlate: string;
    driverName: string | null;
    count: number;
    orders: OrderEntity[];
    invoiceCode?: string | null;
  }> {
    if (!dto.items || dto.items.length === 0) {
      throw new UnprocessableEntityException(
        'Danh sách hàng nhập kho không được để trống',
      );
    }

    const userWithHub = await this.loadUserWithHub(user);

    const plate = dto.licensePlate.trim().toUpperCase();
    const driver = dto.driverName?.trim() || null;
    const date =
      dto.receiveDate?.trim() || new Date().toISOString().split('T')[0];

    const savedOrders: OrderEntity[] = [];
    let sharedTripCode = '';
    let invoiceCode: string | null = null;

    // Execute in transaction for atomicity
    await this.dataSource.transaction(async (manager) => {
      const orderRepo = manager.getRepository(OrderEntity);
      const tripRepo = manager.getRepository(TripEntity);
      const txRepo = manager.getRepository(OrderInventoryTransactionEntity);
      const hubRepo = manager.getRepository(HubEntity);

      let originHubId = userWithHub.hubId || null;
      let originHubName = userWithHub.hub?.name || null;

      // Cho phép Super Admin (hoặc user không bị gắn cố định 1 hub) chỉ định kho tiếp nhận qua dto.hubId
      if (dto.hubId) {
        const targetHub = await hubRepo.findOne({ where: { id: dto.hubId } });
        if (targetHub) {
          originHubId = targetHub.id;
          originHubName = targetHub.name;
        }
      }

      if (!originHubId) {
        throw new BadRequestException(
          'Vui lòng chọn Hub kho tiếp nhận đơn hàng (hubId không được để trống hoặc gán ngầm).',
        );
      }

      // Single shared tripCode for all items on this vehicle
      sharedTripCode =
        normalizeTripCode(dto.tripCode) ||
        (await this.ledgerService.generateTripCode(manager));

      const allDraft = dto.items.every((i) =>
        DRAFT_LIKE_STATUSES.includes(i.initialStatus || 'INBOUND'),
      );

      for (const item of dto.items) {
        let finalOrderCode = item.orderCode?.trim();
        if (isPlaceholderCode(finalOrderCode)) {
          finalOrderCode = await this.orderCodeService.generateOrderCode(
            userWithHub,
            manager,
          );
        }

        let destinationHubName: string | null = null;
        if (item.destinationHubId) {
          const destHub = await hubRepo.findOne({
            where: { id: item.destinationHubId },
          });
          if (destHub) {
            destinationHubName = destHub.name;
          }
        }

        const initialStatus = item.initialStatus || 'INBOUND';
        const isDraft = DRAFT_LIKE_STATUSES.includes(initialStatus);
        const finalGoodsDesc =
          item.goodsDescription?.trim() ||
          (isDraft ? 'Hàng lưu kho (Nháp)' : 'Hàng hóa');
        const qty =
          item.totalQuantity !== undefined && Number(item.totalQuantity) > 0
            ? Number(item.totalQuantity)
            : 1;
        const weight =
          item.totalWeight !== undefined && Number(item.totalWeight) >= 0
            ? Number(item.totalWeight)
            : 0;
        const vol =
          item.totalVolume !== undefined && Number(item.totalVolume) >= 0
            ? Number(item.totalVolume)
            : 0;

        const pickupAddr = item.pickupAddress?.trim() || originHubName || 'Hub';
        const deliveryAddr =
          item.deliveryAddress?.trim() || destinationHubName || 'Điểm đến';

        const existingOrders = finalOrderCode
          ? await orderRepo.find({
              where: { orderCode: finalOrderCode },
              order: { id: 'ASC' },
            })
          : [];

        let savedOrder: OrderEntity;
        let effectiveDeliveryAddr = deliveryAddr;
        let effectiveDestHubId = item.destinationHubId || null;

        if (existingOrders.length > 0) {
          const firstEntry = existingOrders[0];
          let activeEntry =
            existingOrders.find(
              (o) => !DRAFT_LIKE_STATUSES.includes(o.status),
            ) || firstEntry;
          if (existingOrders.length > 1) {
            activeEntry = await this.consolidateSiblingOrdersByCode(
              manager,
              activeEntry,
            );
          }

          const lockedGoodsDesc = firstEntry.goodsDescription || finalGoodsDesc;
          const lockedDestHubName =
            firstEntry.destinationHub || destinationHubName;
          const lockedDestHubId =
            firstEntry.destinationHubId ?? (item.destinationHubId || null);
          const lockedProvince =
            firstEntry.province || item.province?.trim() || null;
          const lockedAccompanyingDocs =
            firstEntry.accompanyingDocs ||
            item.accompanyingDocs?.trim() ||
            null;
          const lockedDeliveryAddr =
            (firstEntry.route && firstEntry.route.includes('→')
              ? firstEntry.route.split('→')[1]?.trim()
              : '') ||
            lockedDestHubName ||
            deliveryAddr;

          effectiveDeliveryAddr = lockedDeliveryAddr;
          effectiveDestHubId = lockedDestHubId;

          const wasDraft = DRAFT_LIKE_STATUSES.includes(activeEntry.status);
          if (wasDraft && !isDraft) {
            activeEntry.totalQuantity = qty;
            activeEntry.inboundQuantity = qty;
            activeEntry.remainingQuantity = qty;
            activeEntry.totalWeight = weight;
            activeEntry.totalVolume = vol;
            activeEntry.status = initialStatus;
            activeEntry.currentHubId = originHubId;
          } else {
            activeEntry.totalQuantity =
              (Number(activeEntry.totalQuantity) || 0) + qty;
            activeEntry.inboundQuantity =
              (Number(activeEntry.inboundQuantity) || 0) + qty;
            activeEntry.remainingQuantity =
              (Number(activeEntry.remainingQuantity) || 0) + qty;
            activeEntry.totalWeight =
              Math.round(
                ((Number(activeEntry.totalWeight) || 0) + weight) * 1000,
              ) / 1000;
            activeEntry.totalVolume =
              Math.round(
                ((Number(activeEntry.totalVolume) || 0) + vol) * 1000,
              ) / 1000;
            if (!isDraft) {
              activeEntry.status = 'INBOUND';
              activeEntry.currentHubId = originHubId;
            }
          }

          activeEntry.goodsDescription = lockedGoodsDesc;
          activeEntry.destinationHub = lockedDestHubName;
          activeEntry.destinationHubId = lockedDestHubId;
          activeEntry.province = lockedProvince;
          activeEntry.accompanyingDocs = lockedAccompanyingDocs;
          activeEntry.originHub =
            item.pickupAddress?.trim() ||
            activeEntry.originHub ||
            originHubName;
          activeEntry.route = `${pickupAddr} → ${lockedDeliveryAddr}`;
          if (item.notes?.trim()) {
            activeEntry.notes = item.notes.trim();
          }

          savedOrder = await orderRepo.save(activeEntry);
        } else {
          const order = orderRepo.create({
            orderCode: finalOrderCode,
            goodsDescription: finalGoodsDesc,
            totalQuantity: qty,
            inboundQuantity: qty,
            outboundQuantity: 0,
            remainingQuantity: qty,
            totalWeight: weight,
            totalVolume: vol,
            route: `${pickupAddr} → ${deliveryAddr}`,
            originHub: item.pickupAddress?.trim() || originHubName,
            originHubId,
            currentHubId: originHubId,
            destinationHub: destinationHubName,
            destinationHubId: item.destinationHubId || null,
            province: item.province?.trim() || null,
            accompanyingDocs: item.accompanyingDocs?.trim() || null,
            notes: item.notes?.trim() || null,
            status: initialStatus,
            createdByUserId: user.id,
            isExternalVehicleNeeded: false,
          });

          savedOrder = await orderRepo.save(order);
        }

        // Create TripEntity linked to this order with shared tripCode
        const trip = await tripRepo.save(
          tripRepo.create({
            orderId: savedOrder.id,
            tripCode: sharedTripCode,
            originHubId,
            destinationHubId: effectiveDestHubId,
            type: 'INBOUND',
            licensePlate: plate,
            driverName: driver,
            status: isDraft ? 'PENDING' : 'COMPLETED',
            pickupDate: date,
            quantityAllocated: qty,
            weightAllocated: weight,
            volumeAllocated: vol,
            notes: `[NHẬP KHO] Xe ${plate} tiếp nhận ${qty} kiện tại ${originHubName || 'Kho'}`,
          }),
        );
        savedOrder.trips = [trip];

        // Inbound Receipt invoice (one shared receipt code for the whole vehicle)
        if (!isDraft) {
          if (!invoiceCode) {
            invoiceCode = await this.ledgerService.generateInvoiceCode(
              InventoryTransactionType.INBOUND,
              originHubId,
              manager,
            );
          }
          await txRepo.save(
            txRepo.create({
              orderId: savedOrder.id,
              type: InventoryTransactionType.INBOUND,
              invoiceCode,
              hubId: originHubId,
              tripId: trip.id,
              tripCode: sharedTripCode,
              quantity: qty,
              expectedQuantity: qty,
              discrepancyQuantity: 0,
              remainingQuantity: savedOrder.remainingQuantity,
              weight: weight,
              volume: vol,
              licensePlate: plate,
              driverName: driver,
              notes:
                item.notes?.trim() ||
                `Tiếp nhận xe ${plate} - ${sharedTripCode}`,
              destination: effectiveDeliveryAddr || null,
              performedByUserId: user.id,
            }),
          );
        }

        (savedOrder as any).deliveryAddress = effectiveDeliveryAddr;
        (savedOrder as any).unit = 'Kiện';
        savedOrders.push(savedOrder);
      }

      if (originHubId) {
        await this.ledgerService.upsertTripStop(
          {
            tripCode: sharedTripCode,
            hubId: originHubId,
            status: allDraft
              ? TripStopStatus.PENDING
              : TripStopStatus.COMPLETED,
            stopType: TripStopType.DESTINATION,
            stopSequence: 1,
            userId: user.id,
          },
          manager,
        );
      }
    });

    return {
      tripCode: sharedTripCode,
      licensePlate: plate,
      driverName: driver,
      count: savedOrders.length,
      orders: savedOrders,
      invoiceCode,
    };
  }

  /**
   * Bốc thêm đơn hàng dọc đường vào chuyến xe đang chạy (SD...)
   * Đơn hàng mới sẽ thuộc chuyến xe hiện tại, tránh tạo chuyến xe mới làm 1 xe mang 2 trip.
   */
  async appendOrderToTrip(
    user: UserEntity,
    tripCodeParam: string,
    dto: AppendOrderToTripDto,
  ): Promise<{
    tripCode: string;
    order: OrderEntity;
    trip: TripEntity;
  }> {
    const tripCode = normalizeTripCode(decodeURIComponent(tripCodeParam || ''));
    if (!tripCode) {
      throw new NotFoundException('Mã chuyến xe không hợp lệ');
    }

    const userWithHub = await this.loadUserWithHub(user);
    let currentOperatingHubId = userWithHub.hubId;
    let currentOperatingHubName = userWithHub.hub?.name || 'Kho tiếp nhận';
    if (!currentOperatingHubId) {
      currentOperatingHubId = 2;
      currentOperatingHubName = 'Magellan Hub - Đà Nẵng';
    }

    await this.validateTripStopEditPermission(
      user,
      tripCode,
      currentOperatingHubId,
      'bốc thêm đơn hàng',
    );

    return this.dataSource.transaction(async (manager) => {
      const tripRepo = manager.getRepository(TripEntity);
      const orderRepo = manager.getRepository(OrderEntity);
      const txRepo = manager.getRepository(OrderInventoryTransactionEntity);
      const hubRepo = manager.getRepository(HubEntity);

      // 1. Tìm chuyến xe hiện tại
      const existingTrips = await tripRepo.find({
        where: { tripCode },
        order: { id: 'ASC' },
      });
      if (!existingTrips || existingTrips.length === 0) {
        throw new NotFoundException(`Không tìm thấy chuyến xe ${tripCode}`);
      }

      const firstTrip = existingTrips[0];
      const licensePlate = firstTrip.licensePlate || 'CHƯA GÁN XE';
      const driverName = firstTrip.driverName || null;
      const pickupDate =
        firstTrip.pickupDate || new Date().toISOString().split('T')[0];

      // 2. Phân loại chế độ bốc hàng: ROADSIDE_INBOUND hoặc HUB_OUTBOUND
      const isHubOutbound = dto.appendMode === AppendOrderMode.HUB_OUTBOUND;

      let destinationHubId: number | null = null;
      let destinationHubName: string | null = null;
      let originHubId: number | null = null;
      let originHubName: string = '';
      let pickupAddr: string = '';
      let deliveryAddr: string = '';

      if (isHubOutbound) {
        if (!dto.destinationHubId) {
          throw new BadRequestException(
            'Vui lòng chọn trạm đích dỡ hàng tiếp theo của chuyến xe',
          );
        }
        if (dto.destinationHubId === currentOperatingHubId) {
          throw new BadRequestException(
            'Kho đích không thể trùng với kho xuất hàng hiện tại',
          );
        }
        const destHub = await hubRepo.findOne({
          where: { id: dto.destinationHubId },
        });
        if (!destHub) {
          throw new NotFoundException(
            `Kho đích ID ${dto.destinationHubId} không tồn tại`,
          );
        }
        destinationHubId = dto.destinationHubId;
        destinationHubName = destHub.name;
        originHubId = currentOperatingHubId ?? null;
        originHubName = currentOperatingHubName;
        pickupAddr = originHubName;
        deliveryAddr = dto.deliveryAddress?.trim() || destinationHubName;
      } else {
        // Mặc định: ROADSIDE_INBOUND (bốc hàng tự do ngoài đường về nhập Hub hiện tại)
        destinationHubId =
          currentOperatingHubId ?? dto.destinationHubId ?? null;
        destinationHubName = currentOperatingHubName;

        if (
          dto.destinationHubId &&
          dto.destinationHubId !== currentOperatingHubId
        ) {
          const destHub = await hubRepo.findOne({
            where: { id: dto.destinationHubId },
          });
          if (destHub) {
            destinationHubName = destHub.name;
          }
        }
        originHubId = null;
        pickupAddr = dto.pickupAddress?.trim() || 'Điểm bốc dọc đường';
        originHubName = pickupAddr;
        deliveryAddr =
          dto.deliveryAddress?.trim() ||
          destinationHubName ||
          'Điểm giao khách';
      }

      // 3. Mã đơn hàng
      let finalOrderCode = dto.orderCode?.trim();
      if (isPlaceholderCode(finalOrderCode)) {
        finalOrderCode = await this.orderCodeService.generateOrderCode(
          userWithHub,
          manager,
        );
      }

      const qty = Math.max(1, Number(dto.totalQuantity) || 1);
      const weight = Math.max(0, Number(dto.totalWeight) || 0);
      const vol = Math.max(0, Number(dto.totalVolume) || 0);

      // 4. Kiểm tra nếu đơn hàng đã lưu trong kho (dành cho HUB_OUTBOUND chọn từ tồn kho)
      let savedOrder: OrderEntity;
      const existingOrderInWarehouse =
        isHubOutbound && dto.orderCode
          ? await orderRepo.findOne({
              where: {
                orderCode: dto.orderCode.trim(),
                deletedAt: null as any,
              },
            })
          : null;

      if (existingOrderInWarehouse) {
        existingOrderInWarehouse.currentTripCode = tripCode;
        existingOrderInWarehouse.destinationHubId = destinationHubId;
        existingOrderInWarehouse.destinationHub = destinationHubName;
        existingOrderInWarehouse.status = 'IN_TRANSIT';
        existingOrderInWarehouse.currentHubId = null;
        if (dto.deliveryAddress?.trim()) {
          existingOrderInWarehouse.notes = [
            existingOrderInWarehouse.notes,
            `[Giao khách: ${dto.deliveryAddress.trim()}]`,
          ]
            .filter(Boolean)
            .join(' - ');
        }
        savedOrder = await orderRepo.save(existingOrderInWarehouse);
      } else {
        const finalNotes =
          [
            dto.notes?.trim(),
            dto.deliveryAddress?.trim()
              ? `[Giao khách: ${dto.deliveryAddress.trim()}]`
              : null,
          ]
            .filter(Boolean)
            .join(' - ') ||
          (isHubOutbound
            ? `Xuất thêm từ ${originHubName} đi ${destinationHubName} trên xe ${licensePlate} (${tripCode})`
            : `Bốc thêm dọc đường tại ${pickupAddr} chở về ${destinationHubName} trên xe ${licensePlate} (${tripCode})`);

        const order = orderRepo.create({
          orderCode: finalOrderCode,
          goodsDescription: dto.goodsDescription.trim(),
          totalQuantity: qty,
          inboundQuantity: 0,
          outboundQuantity: 0,
          remainingQuantity: qty,
          totalWeight: weight,
          totalVolume: vol,
          route: `${pickupAddr} → ${deliveryAddr}`,
          originHub: originHubName,
          originHubId,
          currentHubId: null, // Hàng đang trên xe, chưa nhập kho
          currentTripCode: tripCode,
          destinationHub: destinationHubName,
          destinationHubId,
          province: dto.province?.trim() || null,
          accompanyingDocs: dto.accompanyingDocs?.trim() || null,
          notes: finalNotes,
          status: 'IN_TRANSIT',
          createdByUserId: user.id,
          isExternalVehicleNeeded: false,
        });
        savedOrder = await orderRepo.save(order);
      }

      // 5. Tạo TripEntity gán vào tripCode cũ
      const savedTrip = await tripRepo.save(
        tripRepo.create({
          orderId: savedOrder.id,
          tripCode,
          originHubId,
          destinationHubId,
          type: isHubOutbound ? 'TRANSFER' : 'INBOUND',
          licensePlate,
          driverName,
          status: 'IN_TRANSIT',
          pickupDate,
          weightAllocated: weight,
          volumeAllocated: vol,
          quantityAllocated: qty,
          notes: isHubOutbound
            ? `[XUẤT TỪ HUB] Xe ${licensePlate} nhận thêm ${qty} kiện từ ${originHubName} đi ${destinationHubName}`
            : `[BỐC DỌC ĐƯỜNG] Xe ${licensePlate} bốc thêm ${qty} kiện tại ${pickupAddr} chở về ${destinationHubName}`,
        }),
      );
      savedOrder.trips = [...(savedOrder.trips || []), savedTrip];

      // 6. Ghi nhận giao dịch luân chuyển (TRANSFER) bốc lên xe hoặc nhận tại Hub (INBOUND)
      await txRepo.save(
        txRepo.create({
          orderId: savedOrder.id,
          type: isHubOutbound
            ? InventoryTransactionType.TRANSFER
            : InventoryTransactionType.INBOUND,
          hubId: isHubOutbound ? originHubId : null,
          tripId: savedTrip.id,
          tripCode,
          quantity: qty,
          expectedQuantity: qty,
          discrepancyQuantity: 0,
          remainingQuantity: 0,
          weight,
          volume: vol,
          licensePlate,
          driverName,
          notes: isHubOutbound
            ? `Xuất thêm hàng từ ${originHubName} đi ${destinationHubName} trên xe ${licensePlate} (Chuyến ${tripCode})`
            : `Bốc thêm hàng dọc đường tại ${pickupAddr} chở về ${destinationHubName} trên xe ${licensePlate} (Chuyến ${tripCode})`,
          destination: deliveryAddr,
          performedByUserId: user.id,
        }),
      );

      // 7. Bảo đảm điểm dừng (TripStopEntity) cho kho xuất và kho đích
      if (destinationHubId) {
        const existingDestStop = await manager
          .getRepository(TripStopEntity)
          .findOne({
            where: { tripCode, hubId: destinationHubId },
          });
        if (!existingDestStop) {
          // Lấy sequence lớn nhất để xếp cuối
          const maxSeqRow = await manager.query(
            `SELECT COALESCE(MAX("stopSequence"), 1)::int AS "maxSeq" FROM "trip_stop" WHERE "tripCode" = $1 AND "deletedAt" IS NULL`,
            [tripCode],
          );
          const nextSeq = (Number(maxSeqRow?.[0]?.maxSeq) || 1) + 1;
          await this.ledgerService.upsertTripStop(
            {
              tripCode,
              hubId: destinationHubId,
              status: TripStopStatus.PENDING,
              stopType: TripStopType.DESTINATION,
              stopSequence: nextSeq,
              userId: user.id,
            },
            manager,
          );
        }
      }

      if (isHubOutbound && originHubId) {
        const existingOriginStop = await manager
          .getRepository(TripStopEntity)
          .findOne({
            where: { tripCode, hubId: originHubId },
          });
        if (!existingOriginStop) {
          await this.ledgerService.upsertTripStop(
            {
              tripCode,
              hubId: originHubId,
              status: TripStopStatus.COMPLETED,
              stopType: TripStopType.TRANSIT,
              stopSequence: 1,
              userId: user.id,
            },
            manager,
          );
        }
      }

      return {
        tripCode,
        order: savedOrder,
        trip: savedTrip,
      };
    });
  }

  /**
   * Confirm inbound orders at the current hub (Selective Inbound Tally).
   *
   * Master Contract rules:
   *  - DRAFT orders of this hub: contract fields may still be edited, then the order enters stock.
   *  - Locked orders (left DRAFT / coming from another hub): contract fields are NEVER modified.
   *    An Inbound Receipt invoice records the actual counted quantity and any discrepancy
   *    against the quantity expected from the trip.
   *  - Rows not sent by the client (skipped / kept on the truck) are untouched.
   *  - The trip stop of the current hub becomes COMPLETED (Đã xử lý); other hubs keep their own status.
   */
  async confirmInbound(
    user: UserEntity,
    body: any,
  ): Promise<{
    updatedCount: number;
    newCount?: number;
    orders: OrderEntity[];
    invoiceCode?: string | null;
    tripCode?: string | null;
  }> {
    let rows: any[] = [];
    let tripId: number | undefined;

    if (Array.isArray(body)) {
      rows = body.map((id: number) => ({ id }));
    } else if (body?.orderIds && Array.isArray(body.orderIds)) {
      rows = body.orderIds.map((id: number) => ({ id }));
    } else if (body?.orders && Array.isArray(body.orders)) {
      rows = body.orders;
      tripId = body.tripId;
    } else {
      throw new UnprocessableEntityException(
        'Dữ liệu tiếp nhận kho không hợp lệ',
      );
    }

    if (rows.length === 0) {
      throw new UnprocessableEntityException(
        'Vui lòng chọn ít nhất 1 dòng hàng để tiếp nhận',
      );
    }

    const userWithHub = await this.userRepository.findOne({
      where: { id: user.id },
      relations: ['hub', 'role'],
    });
    let hubId = Number(body?.hubId) || userWithHub?.hubId || null;
    const hubName = userWithHub?.hub?.name || 'Kho';
    const isSuperAdmin =
      (userWithHub?.role?.id ?? user.role?.id) === RoleEnum.SUPER_ADMIN;

    const targetStatus = body?.targetStatus || 'INBOUND';
    const isKeepStatus = targetStatus === 'KEEP';
    const keepTripPending =
      body?.keepTripPending === true || body?.keepTripPending === 'true';
    const inboundPlate = (body?.vehicleLicensePlate || body?.licensePlate || '')
      ?.trim()
      .toUpperCase();
    const inboundDriver = (body?.driverName || '')?.trim();
    const hasDriverField =
      body !== null &&
      typeof body === 'object' &&
      Object.prototype.hasOwnProperty.call(body, 'driverName');
    const inboundDate =
      body?.receiveDate || new Date().toISOString().split('T')[0];

    return this.dataSource.transaction(async (manager) => {
      const orderRepo = manager.getRepository(OrderEntity);
      const tripRepo = manager.getRepository(TripEntity);
      const txRepo = manager.getRepository(OrderInventoryTransactionEntity);
      const hubRepo = manager.getRepository(HubEntity);

      let sharedTripCode = normalizeTripCode(body?.tripCode);
      if (!sharedTripCode && tripId) {
        const trip = await tripRepo.findOne({ where: { id: tripId } });
        sharedTripCode = normalizeTripCode(trip?.tripCode);
      }

      if (!hubId && sharedTripCode) {
        const existingTripRow = await tripRepo.findOne({
          where: { tripCode: sharedTripCode },
        });
        if (existingTripRow?.originHubId) {
          hubId = existingTripRow.originHubId;
        }
      }

      if (sharedTripCode) {
        await this.validateTripStopEditPermission(
          user,
          sharedTripCode,
          hubId ?? undefined,
          'xác nhận dỡ hàng và nhập kho',
        );
      }

      const savedOrders: OrderEntity[] = [];
      const processedTripCodes = new Set<string>();
      let newCreatedCount = 0;
      let invoiceCode: string | null = null;

      const ensureInvoiceCode = async () => {
        if (!invoiceCode) {
          invoiceCode = await this.ledgerService.generateInvoiceCode(
            InventoryTransactionType.INBOUND,
            hubId,
            manager,
          );
        }
        return invoiceCode;
      };

      const ensureTripCodeForPlate = async () => {
        if (!sharedTripCode && inboundPlate) {
          sharedTripCode = await this.ledgerService.generateTripCode(manager);
        }
        return sharedTripCode;
      };

      for (const row of rows) {
        const hasSpecificCode = !isPlaceholderCode(row.orderCode);

        let found: OrderEntity | null = null;
        if (row.id) {
          found = await orderRepo.findOne({ where: { id: Number(row.id) } });
        }
        if (!found && hasSpecificCode) {
          found = await orderRepo.findOne({
            where: { orderCode: String(row.orderCode).trim() },
          });
        }

        let actualQty = 0;
        let expectedQty: number | null = null;
        let rowTripCode = sharedTripCode;
        let discrepancyReason: string | null = null;
        let actualWeight = 0;
        let actualVolume = 0;
        let order: OrderEntity;

        if (found) {
          const isDirectInboundOrDraft =
            DRAFT_LIKE_STATUSES.includes(found.status) ||
            !found.originHubId ||
            found.originHubId === hubId ||
            isSuperAdmin;
          const isEditableDraft =
            (DRAFT_LIKE_STATUSES.includes(found.status) &&
              (!found.originHubId ||
                found.originHubId === hubId ||
                isSuperAdmin)) ||
            (isKeepStatus && isDirectInboundOrDraft);

          if (isEditableDraft) {
            // ── Draft / Pending trip of this hub: contract fields editable ──
            if (hasSpecificCode && row.orderCode) {
              const candidateCode = String(row.orderCode).trim().toUpperCase();
              if (candidateCode && candidateCode !== found.orderCode) {
                const duplicate = await orderRepo.findOne({
                  where: { orderCode: candidateCode },
                });
                if (!duplicate || duplicate.id === found.id) {
                  found.orderCode = candidateCode;
                }
              }
            }
            if (
              row.totalQuantity !== undefined &&
              Number(row.totalQuantity) > 0
            ) {
              const nextQty = Number(row.totalQuantity);
              found.totalQuantity = nextQty;
              if (isKeepStatus) {
                found.inboundQuantity = nextQty;
                found.remainingQuantity = Math.max(
                  0,
                  nextQty - (Number(found.outboundQuantity) || 0),
                );
              }
            }
            if (row.totalWeight !== undefined && Number(row.totalWeight) >= 0) {
              found.totalWeight = Number(row.totalWeight);
            }
            if (row.totalVolume !== undefined && Number(row.totalVolume) >= 0) {
              found.totalVolume = Number(row.totalVolume);
            }
            if (row.goodsDescription) {
              found.goodsDescription = String(row.goodsDescription).trim();
            }
            if (
              row.deliveryAddress !== undefined ||
              row.pickupAddress !== undefined
            ) {
              const currentOrigin =
                row.pickupAddress?.trim() ||
                found.originHub ||
                hubName ||
                'Hub';
              const currentDelivery =
                row.deliveryAddress?.trim() ||
                (found.route?.includes('→')
                  ? found.route.split('→')[1]?.trim()
                  : '') ||
                'Điểm đến';
              found.route = `${currentOrigin} → ${currentDelivery}`;
            }
            if (row.pickupAddress) {
              found.originHub = String(row.pickupAddress).trim();
            }
            if (!found.originHubId && hubId) {
              found.originHubId = hubId;
              found.originHub = found.originHub || hubName;
            }
            if (row.destinationHubId !== undefined) {
              const nextDestHubId = row.destinationHubId
                ? Number(row.destinationHubId)
                : null;
              found.destinationHubId = nextDestHubId;
              if (nextDestHubId) {
                const destHub = await hubRepo.findOne({
                  where: { id: nextDestHubId },
                });
                if (destHub) {
                  found.destinationHub = destHub.name;
                }
              } else if (row.deliveryMode === 'DIRECT_CUSTOMER') {
                found.destinationHub = null;
              }
            }
            if (!isKeepStatus) {
              const q = Number(found.totalQuantity) || 1;
              found.status = 'INBOUND';
              found.inboundQuantity = q;
              found.remainingQuantity = q;
              found.outboundQuantity = 0;
              found.currentHubId = hubId;
              found.currentTripCode = null;
              actualQty = q;
              expectedQty = q;
              actualWeight = Number(found.totalWeight) || 0;
              actualVolume = Number(found.totalVolume) || 0;
            }
          } else if (!isKeepStatus) {
            // ── Locked contract: record an Inbound Receipt, never touch contract fields ──
            rowTripCode =
              sharedTripCode || normalizeTripCode(found.currentTripCode);

            const checkTripCode = rowTripCode || sharedTripCode;
            if (checkTripCode && hubId) {
              const already = await txRepo.findOne({
                where: {
                  orderId: found.id,
                  tripCode: checkTripCode,
                  hubId,
                  type: InventoryTransactionType.INBOUND,
                },
              });
              if (already) {
                const requestedQty = Number(
                  row.actualQuantity ?? row.totalQuantity,
                );
                if (isSuperAdmin && requestedQty > 0) {
                  const qtyDiff = requestedQty - Number(already.quantity);
                  already.quantity = requestedQty;
                  if (
                    row.totalWeight !== undefined &&
                    Number(row.totalWeight) >= 0
                  ) {
                    already.weight = Number(row.totalWeight);
                  }
                  if (
                    row.totalVolume !== undefined &&
                    Number(row.totalVolume) >= 0
                  ) {
                    already.volume = Number(row.totalVolume);
                  }
                  await txRepo.save(already);

                  if (qtyDiff !== 0) {
                    found.inboundQuantity = Math.max(
                      0,
                      (Number(found.inboundQuantity) || 0) + qtyDiff,
                    );
                    if (
                      Number(found.inboundQuantity) >
                      (Number(found.totalQuantity) || 0)
                    ) {
                      found.totalQuantity = Number(found.inboundQuantity);
                    }
                    found.remainingQuantity = Math.max(
                      0,
                      Number(found.inboundQuantity) -
                        (Number(found.outboundQuantity) || 0),
                    );
                  }
                  if (
                    row.totalWeight !== undefined &&
                    Number(row.totalWeight) >= 0
                  ) {
                    found.totalWeight = Number(row.totalWeight);
                  }
                  if (
                    row.totalVolume !== undefined &&
                    Number(row.totalVolume) >= 0
                  ) {
                    found.totalVolume = Number(row.totalVolume);
                  }
                  if (row.notes !== undefined) {
                    found.notes = row.notes?.trim() || null;
                  }
                  await orderRepo.save(found);

                  const existingTrip = await tripRepo.findOne({
                    where: { orderId: found.id, tripCode: checkTripCode },
                  });
                  if (existingTrip) {
                    existingTrip.quantityAllocated = requestedQty;
                    if (
                      row.totalWeight !== undefined &&
                      Number(row.totalWeight) >= 0
                    ) {
                      existingTrip.weightAllocated = Number(row.totalWeight);
                    }
                    if (
                      row.totalVolume !== undefined &&
                      Number(row.totalVolume) >= 0
                    ) {
                      existingTrip.volumeAllocated = Number(row.totalVolume);
                    }
                    if (inboundPlate) existingTrip.licensePlate = inboundPlate;
                    if (inboundDriver) existingTrip.driverName = inboundDriver;
                    await tripRepo.save(existingTrip);
                  }
                }

                let deliv = '';
                if (found.route && found.route.includes('→')) {
                  deliv = found.route.split('→')[1]?.trim() || '';
                }
                if (!deliv && found.notes) {
                  const match = found.notes.match(/\[Giao khách:\s*([^\]]+)\]/);
                  if (match) deliv = match[1].trim();
                }
                if (!deliv) {
                  deliv = found.destinationHub || found.province || '—';
                }
                (found as any).deliveryAddress = deliv;
                (found as any).unit = 'Kiện';
                savedOrders.push(found);
                if (checkTripCode) processedTripCodes.add(checkTripCode);
                continue;
              }
            }

            let inTransit: number | null = null;
            if (rowTripCode) {
              const t = await this.ledgerService.getInTransitQuantity(
                found.id,
                rowTripCode,
                manager,
              );
              if (t.loaded > 0) inTransit = t.inTransit;
            }
            expectedQty =
              row.expectedQuantity !== undefined &&
              row.expectedQuantity !== null
                ? Number(row.expectedQuantity)
                : inTransit;

            const rawActual = row.actualQuantity ?? row.totalQuantity;
            actualQty =
              rawActual !== undefined && rawActual !== null && rawActual !== ''
                ? Number(rawActual)
                : (expectedQty ?? (Number(found.totalQuantity) || 1));

            if (!Number.isFinite(actualQty) || actualQty <= 0) {
              throw new UnprocessableEntityException(
                `Đơn ${found.orderCode}: Số kiện thực nhận phải lớn hơn 0.`,
              );
            }

            discrepancyReason = row.discrepancyReason?.trim() || null;
            actualWeight =
              row.actualWeight !== undefined
                ? Number(row.actualWeight) || 0
                : this.proportional(
                    found.totalWeight,
                    actualQty,
                    found.totalQuantity,
                  );
            actualVolume =
              row.actualVolume !== undefined
                ? Number(row.actualVolume) || 0
                : this.proportional(
                    found.totalVolume,
                    actualQty,
                    found.totalQuantity,
                  );

            found.inboundQuantity =
              (Number(found.inboundQuantity) || 0) + actualQty;
            if (
              Number(found.inboundQuantity) > (Number(found.totalQuantity) || 0)
            ) {
              found.totalQuantity = Number(found.inboundQuantity);
              found.totalWeight =
                Math.round(
                  ((Number(found.totalWeight) || 0) + actualWeight) * 1000,
                ) / 1000;
              found.totalVolume =
                Math.round(
                  ((Number(found.totalVolume) || 0) + actualVolume) * 1000,
                ) / 1000;
            }
            found.remainingQuantity = Math.max(
              0,
              Number(found.inboundQuantity) -
                (Number(found.outboundQuantity) || 0),
            );
            found.status = 'INBOUND';
            found.currentHubId = hubId;
            if (
              rowTripCode &&
              found.currentTripCode === rowTripCode &&
              (inTransit === null || inTransit - actualQty <= 0)
            ) {
              found.currentTripCode = null;
            }
          }

          // Operational fields remain editable on all pending trips
          if (row.province !== undefined) {
            found.province = row.province?.trim() || null;
          }
          if (row.accompanyingDocs !== undefined) {
            found.accompanyingDocs = row.accompanyingDocs?.trim() || null;
          }
          if (row.notes !== undefined) {
            found.notes = row.notes?.trim() || null;
          }

          order = await orderRepo.save(found);
        } else {
          // ── New row added en-route: create a new Master Contract ──
          let newOrderCode = row.orderCode?.trim();
          if (!hasSpecificCode || !newOrderCode) {
            newOrderCode = userWithHub
              ? await this.orderCodeService.generateOrderCode(
                  userWithHub,
                  manager,
                )
              : `ORD-${Date.now()}`;
          }

          let newDestHubName: string | null = row.destinationHub || null;
          const newDestHubId = row.destinationHubId
            ? Number(row.destinationHubId)
            : null;
          if (!newDestHubName && newDestHubId) {
            const destHub = await hubRepo.findOne({
              where: { id: newDestHubId },
            });
            if (destHub) newDestHubName = destHub.name;
          }

          const initQty = Number(row.totalQuantity) || 1;
          const newOrder = orderRepo.create({
            orderCode: newOrderCode,
            goodsDescription: (
              row.goodsDescription || 'Hàng gom luân chuyển'
            ).trim(),
            totalQuantity: initQty,
            inboundQuantity: initQty,
            outboundQuantity: 0,
            remainingQuantity: initQty,
            totalWeight: Number(row.totalWeight) || 0,
            totalVolume: Number(row.totalVolume) || 0,
            route: `${row.pickupAddress?.trim() || hubName || 'Hub'} → ${row.deliveryAddress || newDestHubName || 'Điểm giao'}`,
            originHub:
              row.pickupAddress?.trim() || userWithHub?.hub?.name || null,
            originHubId: hubId,
            currentHubId: hubId,
            destinationHub: newDestHubName,
            destinationHubId: newDestHubId,
            province: row.province?.trim() || null,
            accompanyingDocs: row.accompanyingDocs?.trim() || null,
            notes: row.notes?.trim() || 'Hàng tiếp nhận xe nhập kho',
            status: isKeepStatus ? 'DRAFT' : 'INBOUND',
            createdByUserId: user.id,
            isExternalVehicleNeeded: false,
          });

          order = await orderRepo.save(newOrder);
          newCreatedCount++;
          if (!isKeepStatus) {
            actualQty = initQty;
            expectedQty = initQty;
            actualWeight = Number(order.totalWeight) || 0;
            actualVolume = Number(order.totalVolume) || 0;
          }
        }

        let deliv = '';
        if (order.route && order.route.includes('→')) {
          deliv = order.route.split('→')[1]?.trim() || '';
        }
        if (!deliv && order.notes) {
          const match = order.notes.match(/\[Giao khách:\s*([^\]]+)\]/);
          if (match) deliv = match[1].trim();
        }
        if (!deliv) {
          deliv = order.destinationHub || order.province || '—';
        }
        (order as any).deliveryAddress = deliv;
        (order as any).unit = 'Kiện';
        savedOrders.push(order);

        // Link the order to the vehicle trip (allocation row) and sync allocated metrics
        let linkedTripId: number | null = null;
        const code = rowTripCode || (await ensureTripCodeForPlate());
        rowTripCode = code;
        if (code) {
          const existingTrip = await tripRepo.findOne({
            where: { orderId: order.id, tripCode: code },
          });
          const allocQty =
            Number(
              row.actualQuantity ?? row.totalQuantity ?? order.totalQuantity,
            ) || 1;
          const allocWt =
            row.totalWeight !== undefined
              ? Number(row.totalWeight) || 0
              : Number(order.totalWeight) || 0;
          const allocVol =
            row.totalVolume !== undefined
              ? Number(row.totalVolume) || 0
              : Number(order.totalVolume) || 0;
          const allocDestHubId =
            row.destinationHubId !== undefined
              ? row.destinationHubId
                ? Number(row.destinationHubId)
                : null
              : order.destinationHubId || null;

          if (existingTrip) {
            if (inboundPlate) existingTrip.licensePlate = inboundPlate;
            if (hasDriverField) {
              existingTrip.driverName = inboundDriver || null;
            } else if (inboundDriver) {
              existingTrip.driverName = inboundDriver;
            }
            if (inboundDate) existingTrip.pickupDate = inboundDate;
            existingTrip.destinationHubId = allocDestHubId;
            existingTrip.quantityAllocated = allocQty;
            existingTrip.weightAllocated = allocWt;
            existingTrip.volumeAllocated = allocVol;
            if (!isKeepStatus && !keepTripPending) {
              existingTrip.status = 'COMPLETED';
            }
            await tripRepo.save(existingTrip);
            linkedTripId = existingTrip.id;
          } else {
            const createdTrip = await tripRepo.save(
              tripRepo.create({
                orderId: order.id,
                tripCode: code,
                originHubId: hubId,
                destinationHubId: allocDestHubId,
                type: 'INBOUND',
                licensePlate: inboundPlate || null,
                driverName: inboundDriver || null,
                status:
                  isKeepStatus || keepTripPending ? 'PENDING' : 'COMPLETED',
                pickupDate: inboundDate,
                quantityAllocated: allocQty,
                weightAllocated: allocWt,
                volumeAllocated: allocVol,
                notes: `[NHẬP KHO] Xe nhập ${actualQty || allocQty} kiện tại ${hubName}`,
              }),
            );
            linkedTripId = createdTrip.id;
          }
        }

        if (rowTripCode) processedTripCodes.add(rowTripCode);

        // Inbound Receipt invoice (one shared receipt code per confirmation)
        if (!isKeepStatus && actualQty > 0) {
          const discrepancy =
            expectedQty !== null ? actualQty - expectedQty : 0;
          const code = await ensureInvoiceCode();
          await txRepo.save(
            txRepo.create({
              orderId: order.id,
              type: InventoryTransactionType.INBOUND,
              invoiceCode: code,
              hubId,
              tripId: linkedTripId,
              tripCode: rowTripCode || null,
              quantity: actualQty,
              expectedQuantity: expectedQty,
              discrepancyQuantity: discrepancy,
              discrepancyReason,
              remainingQuantity: order.remainingQuantity ?? actualQty,
              weight: actualWeight,
              volume: actualVolume,
              licensePlate: inboundPlate || null,
              driverName: inboundDriver || null,
              destination: order.destinationHub || order.province || null,
              performedByUserId: user.id,
              notes:
                discrepancy !== 0
                  ? `Nhập kho tại ${hubName}: thực nhận ${actualQty}/${expectedQty} kiện (${discrepancy > 0 ? 'thừa' : 'thiếu'} ${Math.abs(discrepancy)} kiện)`
                  : keepTripPending
                    ? `Nhập riêng đơn lẻ từ xe ${inboundPlate || rowTripCode || ''} tại ${hubName}`
                    : inboundPlate
                      ? `Nhập kho từ xe ${inboundPlate} tại ${hubName}`
                      : `Tiếp nhận lưu kho tại ${hubName}`,
            }),
          );
        }
      }

      // Synchronize removed lines on the inbound trip (for BOTH save draft and confirm inbound)
      if (sharedTripCode && savedOrders.length > 0) {
        const keptOrderIds = new Set(savedOrders.map((o) => o.id));
        const allTripLines = await tripRepo.find({
          where: { tripCode: sharedTripCode },
        });
        const removedTripLines = allTripLines.filter(
          (t) =>
            t.type === 'INBOUND' &&
            !keptOrderIds.has(t.orderId) &&
            (!hubId || !t.originHubId || t.originHubId === hubId),
        );
        if (removedTripLines.length > 0) {
          const removedOrderIds = removedTripLines.map((t) => t.orderId);
          await tripRepo.softDelete(removedTripLines.map((t) => t.id));
          for (const remOrderId of removedOrderIds) {
            const otherTripsCount = await tripRepo.count({
              where: { orderId: remOrderId },
            });
            const priorInboundTxCount = await txRepo.count({
              where: {
                orderId: remOrderId,
                type: InventoryTransactionType.INBOUND,
              },
            });

            const remOrder = await orderRepo.findOne({
              where: { id: remOrderId },
            });

            if (remOrder) {
              let hasPriorInbound = priorInboundTxCount > 0;
              if (!hasPriorInbound && remOrder.orderCode) {
                const codeTxCount = await txRepo
                  .createQueryBuilder('tx')
                  .innerJoin('tx.order', 'o')
                  .where('o.orderCode = :code', { code: remOrder.orderCode })
                  .andWhere('tx.type = :type', {
                    type: InventoryTransactionType.INBOUND,
                  })
                  .andWhere('tx.deletedAt IS NULL')
                  .getCount();
                if (codeTxCount > 0) hasPriorInbound = true;
              }

              if (
                otherTripsCount === 0 &&
                !hasPriorInbound &&
                DRAFT_LIKE_STATUSES.includes(remOrder.status)
              ) {
                // Case 1: Đơn tạo mới theo chuyến xe nhưng bị xóa khi nhận xe (thực tế không có hàng)
                // -> Xóa triệt để đơn hàng kho để không lưu lại đơn nháp rác
                await orderRepo.softDelete(remOrder.id);
              } else if (remOrder.currentTripCode === sharedTripCode) {
                // Case 2: Đơn đã có lưu kho trước (hàng về nhiều đợt)
                // -> Các thông tin của mã vận đơn này KHÔNG THAY ĐỔI, chỉ gỡ mã chuyến xe hiện tại
                remOrder.currentTripCode = null;
                await orderRepo.save(remOrder);
              }
            }
          }
        }
      }

      // Vehicle info corrections on the trip allocation rows (operational, not contract)
      if (sharedTripCode && (inboundPlate || hasDriverField || inboundDate)) {
        const existingTrips = await tripRepo.find({
          where: { tripCode: sharedTripCode },
        });
        for (const t of existingTrips) {
          if (inboundPlate) t.licensePlate = inboundPlate;
          if (hasDriverField) {
            t.driverName = inboundDriver || null;
          } else if (inboundDriver) {
            t.driverName = inboundDriver;
          }
          if (inboundDate) t.pickupDate = inboundDate;
        }
        if (existingTrips.length > 0) await tripRepo.save(existingTrips);
      }
      if (tripId) {
        const trip = await tripRepo.findOne({ where: { id: tripId } });
        if (trip && !isKeepStatus && !keepTripPending) {
          trip.notes =
            (trip.notes ? `${trip.notes} · ` : '') +
            `Đã dỡ hàng tại ${hubName}`;
          await tripRepo.save(trip);
        }
      }

      // Per-hub trip status: this hub becomes "Đã xử lý" (or stays "Chờ xử lý" on save draft or keepTripPending)
      if (hubId) {
        for (const code of processedTripCodes) {
          if (keepTripPending || isKeepStatus) {
            await this.ledgerService.upsertTripStop(
              {
                tripCode: code,
                hubId,
                status: TripStopStatus.PENDING,
                stopType: TripStopType.DESTINATION,
                stopSequence: 1,
                userId: user.id,
              },
              manager,
            );
          } else {
            await this.ledgerService.upsertTripStop(
              {
                tripCode: code,
                hubId,
                status: TripStopStatus.COMPLETED,
                stopType: TripStopType.DESTINATION,
                stopSequence: 1,
                userId: user.id,
              },
              manager,
            );

            // All stops processed → the trip is fully unloaded
            await manager.query(
              `UPDATE "trip" SET "status" = 'COMPLETED', "updatedAt" = NOW()
               WHERE "tripCode" = $1 AND "deletedAt" IS NULL AND "status" <> 'COMPLETED'
                 AND NOT EXISTS (SELECT 1 FROM "trip_stop" s WHERE s."tripCode" = $1 AND s."status" = 'PENDING' AND s."deletedAt" IS NULL)`,
              [code],
            );
          }
        }
      }

      if (!isKeepStatus) {
        for (const ord of savedOrders) {
          await this.activityLogService.safeLogActivity(
            {
              orderId: ord.id,
              orderCode: ord.orderCode,
              action: OrderActivityAction.INBOUND_CONFIRMED,
              actorUserId: Number(user?.id || 0),
              actorEmail: user?.email || undefined,
              hubId: Number(hubId || ord.currentHubId || ord.originHubId || 0),
              hubName: hubName || ord.originHub || 'N/A Hub',
              tripCode: sharedTripCode || null,
              quantity: ord.inboundQuantity ?? ord.totalQuantity ?? 1,
              reason: `Xác nhận nhập kho${sharedTripCode ? ` chuyến ${sharedTripCode}` : ''}${inboundPlate ? ` (xe ${inboundPlate})` : ''}`,
              newValues: {
                totalQuantity: ord.totalQuantity,
                inboundQuantity: ord.inboundQuantity,
                outboundQuantity: ord.outboundQuantity,
                remainingQuantity: ord.remainingQuantity,
                status: ord.status,
              },
            },
            manager,
          );
        }
      }

      return {
        updatedCount: savedOrders.length - newCreatedCount,
        newCount: newCreatedCount,
        orders: savedOrders,
        invoiceCode,
        tripCode: sharedTripCode || null,
      };
    });
  }

  /**
   * Consolidate historical split sibling OrderEntity rows sharing the same orderCode
   * into `primaryOrder`, preserving all TripEntity and OrderInventoryTransactionEntity rows
   * and locking canonical master fields (goodsDescription, destinationHub) to the first entry.
   */
  private async consolidateSiblingOrdersByCode(
    manager: EntityManager,
    primaryOrder: OrderEntity,
  ): Promise<OrderEntity> {
    if (!primaryOrder?.orderCode) return primaryOrder;
    const orderRepo = manager.getRepository(OrderEntity);
    const siblings = await orderRepo.find({
      where: { orderCode: primaryOrder.orderCode },
      order: { id: 'ASC' },
    });
    if (siblings.length <= 1) return primaryOrder;

    const firstEntry = siblings[0];
    const nonDrafts = siblings.filter(
      (s) => !DRAFT_LIKE_STATUSES.includes(s.status),
    );
    const activeSiblings = nonDrafts.length > 0 ? nonDrafts : siblings;

    primaryOrder.goodsDescription =
      firstEntry.goodsDescription || primaryOrder.goodsDescription;
    primaryOrder.destinationHub =
      firstEntry.destinationHub || primaryOrder.destinationHub;
    primaryOrder.destinationHubId =
      firstEntry.destinationHubId ?? primaryOrder.destinationHubId;
    primaryOrder.province = firstEntry.province || primaryOrder.province;
    primaryOrder.accompanyingDocs =
      firstEntry.accompanyingDocs || primaryOrder.accompanyingDocs;
    if (firstEntry.route && firstEntry.route.includes('→')) {
      primaryOrder.route = firstEntry.route;
    }

    primaryOrder.totalQuantity = activeSiblings.reduce(
      (sum, s) => sum + (Number(s.totalQuantity) || 0),
      0,
    );
    primaryOrder.inboundQuantity = activeSiblings.reduce(
      (sum, s) => sum + (Number(s.inboundQuantity) || 0),
      0,
    );
    primaryOrder.outboundQuantity = activeSiblings.reduce(
      (sum, s) => sum + (Number(s.outboundQuantity) || 0),
      0,
    );
    primaryOrder.remainingQuantity = activeSiblings.reduce(
      (sum, s) => sum + (Number(s.remainingQuantity) || 0),
      0,
    );
    primaryOrder.totalWeight =
      Math.round(
        activeSiblings.reduce(
          (sum, s) => sum + (Number(s.totalWeight) || 0),
          0,
        ) * 1000,
      ) / 1000;
    primaryOrder.totalVolume =
      Math.round(
        activeSiblings.reduce(
          (sum, s) => sum + (Number(s.totalVolume) || 0),
          0,
        ) * 1000,
      ) / 1000;
    if (
      nonDrafts.length > 0 &&
      DRAFT_LIKE_STATUSES.includes(primaryOrder.status)
    ) {
      primaryOrder.status = nonDrafts[0].status;
    }

    const allSiblingIds = siblings.map((s) => s.id);
    const otherIds = siblings
      .filter((s) => s.id !== primaryOrder.id)
      .map((s) => s.id);
    if (otherIds.length > 0) {
      const tripRepo = manager.getRepository(TripEntity);
      const allSiblingTrips = await tripRepo.find({
        where: { orderId: In(allSiblingIds) },
        order: { id: 'ASC' },
      });
      const tripByCode = new Map<string, TripEntity>();
      const duplicateTripIds: number[] = [];
      for (const tr of allSiblingTrips) {
        const key = tr.tripCode || `id-${tr.id}`;
        const existingTr = tripByCode.get(key);
        if (!existingTr) {
          tripByCode.set(key, tr);
        } else {
          existingTr.quantityAllocated =
            (Number(existingTr.quantityAllocated) || 0) +
            (Number(tr.quantityAllocated) || 0);
          existingTr.weightAllocated =
            Math.round(
              ((Number(existingTr.weightAllocated) || 0) +
                (Number(tr.weightAllocated) || 0)) *
                1000,
            ) / 1000;
          existingTr.volumeAllocated =
            Math.round(
              ((Number(existingTr.volumeAllocated) || 0) +
                (Number(tr.volumeAllocated) || 0)) *
                1000,
            ) / 1000;
          duplicateTripIds.push(tr.id);
        }
      }
      if (duplicateTripIds.length > 0) {
        await manager.query(
          `UPDATE "order_inventory_transaction" SET "tripId" = NULL WHERE "tripId" = ANY($1)`,
          [duplicateTripIds],
        );
        await tripRepo.softDelete(duplicateTripIds);
      }
      for (const keptTr of tripByCode.values()) {
        keptTr.orderId = primaryOrder.id;
        await tripRepo.save(keptTr);
      }

      await manager.query(
        `UPDATE "order_inventory_transaction" SET "orderId" = $1 WHERE "orderId" = ANY($2)`,
        [primaryOrder.id, otherIds],
      );
      await orderRepo.softDelete(otherIds);
    }

    const savedPrimary = await orderRepo.save(primaryOrder);
    (savedPrimary as any).__mergedOrderIds = allSiblingIds;
    return savedPrimary;
  }

  private mergeOutboundItemsForOrder(
    items: ConfirmOutboundDto['items'],
    order: OrderEntity,
  ) {
    if (!items || items.length === 0) return undefined;
    const mergedIds: number[] = (order as any).__mergedOrderIds || [order.id];
    const matched = items.filter((i) => mergedIds.includes(Number(i.orderId)));
    if (matched.length === 0) return undefined;
    if (matched.length === 1) return matched[0];
    const first = matched[0];
    return {
      ...first,
      orderId: order.id,
      quantityToExport: matched.reduce(
        (sum, m) => sum + (Number(m.quantityToExport) || 0),
        0,
      ),
      weightToExport:
        Math.round(
          matched.reduce((sum, m) => sum + (Number(m.weightToExport) || 0), 0) *
            1000,
        ) / 1000,
      volumeToExport:
        Math.round(
          matched.reduce((sum, m) => sum + (Number(m.volumeToExport) || 0), 0) *
            1000,
        ) / 1000,
    };
  }

  /**
   * Confirm outbound dispatch (Customer vs Transfer).
   * - Validates against the stock of the dispatching hub (invoice ledger).
   * - Allocates ONE SD trip code + ONE dispatch invoice for the whole vehicle.
   * - Never modifies Master Contract fields (destinationHubId stays the contract destination;
   *   transfer routing is represented by trip stops).
   */
  async confirmOutbound(
    user: UserEntity,
    dto: ConfirmOutboundDto,
  ): Promise<{
    updatedCount: number;
    orders: OrderEntity[];
    trip?: TripEntity;
    tripCode?: string;
    invoiceCode?: string;
  }> {
    const targetOrderIds =
      dto.items && dto.items.length > 0
        ? dto.items.map((i) => i.orderId)
        : dto.orderIds || [];

    if (!targetOrderIds || targetOrderIds.length === 0) {
      throw new NotFoundException('Không tìm thấy đơn hàng nào để xuất kho');
    }

    const userHubId = (await this.resolveUserHubId(user)) ?? null;

    return this.dataSource.transaction(async (manager) => {
      const orderRepo = manager.getRepository(OrderEntity);
      const tripRepo = manager.getRepository(TripEntity);
      const txRepo = manager.getRepository(OrderInventoryTransactionEntity);
      const hubRepo = manager.getRepository(HubEntity);

      const rawOrders = await orderRepo.find({
        where: { id: In(targetOrderIds) },
      });

      if (rawOrders.length === 0) {
        throw new NotFoundException('Không tìm thấy đơn hàng nào để xuất kho');
      }

      const orders: OrderEntity[] = [];
      const seenCodes = new Set<string>();
      for (const ro of rawOrders) {
        if (ro.orderCode && seenCodes.has(ro.orderCode)) continue;
        if (ro.orderCode) seenCodes.add(ro.orderCode);
        const consolidated = await this.consolidateSiblingOrdersByCode(
          manager,
          ro,
        );
        orders.push(consolidated);
      }

      // Strict Pending Guard (Task #51): Trips with draft orders can only stay PENDING ("Chờ xử lý").
      // Confirming outbound (COMPLETED) is strictly forbidden for any DRAFT / WAITING / PENDING orders.
      const draftOrders = orders.filter((o) =>
        DRAFT_LIKE_STATUSES.includes(o.status),
      );
      if (draftOrders.length > 0) {
        const draftCodes = draftOrders.map((o) => o.orderCode).join(', ');
        throw new BadRequestException(
          `Không thể chuyển chuyến xe sang trạng thái "Đã xử lý" vì chuyến xe có chứa ${draftOrders.length} đơn hàng đang ở trạng thái đơn nháp (${draftCodes}). Chuyến xe có đơn nháp chỉ được phép ở trạng thái "Chờ xử lý". Vui lòng duyệt đơn hàng trước khi xuất kho.`,
        );
      }

      // Auto-detect isTransfer if mode is TRANSFER OR any item/order has a destination hub different from origin
      const actingOriginId =
        userHubId ?? orders[0].currentHubId ?? orders[0].originHubId ?? null;
      const hasTransferItem = orders.some((order) => {
        const item = this.mergeOutboundItemsForOrder(dto.items, order);
        if (item?.deliveryMode === 'DIRECT_CUSTOMER') return false;
        const destId =
          item?.destinationHubId ??
          (dto.mode === OutboundMode.TRANSFER ? dto.destinationHubId : null);
        return destId && destId !== actingOriginId;
      });
      const isTransfer = dto.mode === OutboundMode.TRANSFER || hasTransferItem;

      const originHubId = actingOriginId;
      // Confirming a saved draft ("Chờ xử lý"): keep its SD code, drop the planned lines
      const draftCode = normalizeTripCode(dto.draftTripCode);
      if (draftCode) {
        await this.discardOutboundDraftLines(manager, draftCode, userHubId);
      }
      const tripCode =
        draftCode || (await this.ledgerService.generateTripCode(manager));
      const invoiceCode = await this.ledgerService.generateInvoiceCode(
        isTransfer
          ? InventoryTransactionType.TRANSFER
          : InventoryTransactionType.OUTBOUND,
        originHubId,
        manager,
      );
      const dispatchDate =
        dto.dispatchDate || new Date().toISOString().split('T')[0];

      let createdTrip: TripEntity | undefined;

      for (const order of orders) {
        const item = this.mergeOutboundItemsForOrder(dto.items, order);
        const actingHubId =
          userHubId ?? order.currentHubId ?? order.originHubId ?? null;

        const hubStock = actingHubId
          ? await this.ledgerService.getHubStock(order.id, actingHubId, manager)
          : null;
        const availableQty =
          hubStock !== null
            ? hubStock
            : order.remainingQuantity !== undefined &&
                order.remainingQuantity !== null
              ? order.remainingQuantity
              : order.totalQuantity || 0;

        const pendingAlloc =
          await this.ledgerService.getPendingOutboundAllocation(
            order.id,
            actingHubId,
            draftCode || undefined,
            manager,
          );
        const effectiveAvailable = Math.max(
          0,
          availableQty - pendingAlloc.pendingQty,
        );

        const qtyToExport =
          item && item.quantityToExport !== undefined
            ? Number(item.quantityToExport)
            : effectiveAvailable;

        if (qtyToExport <= 0) {
          throw new UnprocessableEntityException(
            `Đơn hàng ${order.orderCode}: Số lượng xuất phải lớn hơn 0.`,
          );
        }

        if (qtyToExport > effectiveAvailable) {
          const tripHint =
            pendingAlloc.tripCodes.length > 0
              ? ` (${pendingAlloc.tripCodes.join(', ')})`
              : '';
          throw new UnprocessableEntityException(
            `Mã đơn ${order.orderCode}: Số lượng xuất (${qtyToExport}) vượt quá tồn kho khả dụng còn lại (${effectiveAvailable} kiện). Đơn hàng đang được xếp ${pendingAlloc.pendingQty} kiện trong chuyến xe chờ xuất${tripHint}.`,
          );
        }

        const hubStockAfter = Math.max(0, availableQty - qtyToExport);
        order.outboundQuantity = (order.outboundQuantity || 0) + qtyToExport;
        order.remainingQuantity = Math.max(
          0,
          (Number(order.remainingQuantity) || 0) - qtyToExport,
        );

        if (order.remainingQuantity === 0) {
          order.status = 'COMPLETED_INBOUND'; // ĐÃ XUẤT KHO toàn bộ
        } else {
          order.status = 'INBOUND'; // Còn tồn kho, giữ LƯU KHO để xuất đợt tiếp theo
        }

        const isLineDirectCustomer =
          item?.deliveryMode === 'DIRECT_CUSTOMER' ||
          (!item?.destinationHubId &&
            item?.deliveryMode !== 'HUB_L1' &&
            item?.deliveryMode !== 'XE_BO' &&
            dto.mode !== OutboundMode.TRANSFER);

        const itemDestHubId = isLineDirectCustomer
          ? null
          : (item?.destinationHubId ??
            (dto.mode === OutboundMode.TRANSFER &&
            dto.destinationHubId &&
            dto.destinationHubId !== actingHubId
              ? dto.destinationHubId
              : null));

        // Master Contract Destination Invariance (Task 41):
        // NEVER overwrite order.destinationHub, order.destinationHubId, order.destinationHubEntity, or order.route.
        // Look up destination hub and delivery address only for trip dispatch and transaction audit.
        const destHub =
          !isLineDirectCustomer &&
          itemDestHubId &&
          itemDestHubId !== actingHubId
            ? await hubRepo.findOne({ where: { id: itemDestHubId } })
            : null;
        const destHubName = destHub?.name
          ? destHub.address && !destHub.name.includes(destHub.address)
            ? `${destHub.name} — ${destHub.address}`
            : destHub.name
          : null;
        const outboundDeliveryAddress = item?.deliveryAddress || null;
        const outboundTargetName = isLineDirectCustomer
          ? outboundDeliveryAddress || order.destinationHub || 'Khách nhận'
          : destHubName || outboundDeliveryAddress || 'Trạm nhận';

        const isTransferLine =
          !isLineDirectCustomer &&
          (!!itemDestHubId || dto.mode === OutboundMode.TRANSFER);

        if (isTransferLine) {
          order.currentTripCode = tripCode;
        }
        if (hubStockAfter === 0 && order.currentHubId === actingHubId) {
          order.currentHubId = null;
        }

        const weight = Number(
          item?.weightToExport ??
            this.proportional(
              order.totalWeight,
              qtyToExport,
              order.totalQuantity,
            ),
        );
        const volume = Number(
          item?.volumeToExport ??
            this.proportional(
              order.totalVolume,
              qtyToExport,
              order.totalQuantity,
            ),
        );

        const tripNotes = isTransferLine
          ? `[XUẤT KHO - LUÂN CHUYỂN] Xuất ${qtyToExport} kiện đến ${outboundTargetName}`
          : `[XUẤT KHO - GIAO KHÁCH] Xuất ${qtyToExport} kiện giao khách`;

        const tripDestHubId = isLineDirectCustomer
          ? null
          : itemDestHubId && itemDestHubId !== actingHubId
            ? itemDestHubId
            : null;

        createdTrip = await tripRepo.save(
          tripRepo.create({
            orderId: order.id,
            tripCode,
            originHubId: actingHubId,
            destinationHubId: tripDestHubId,
            type: isTransferLine ? 'TRANSFER' : 'OUTBOUND',
            licensePlate: dto.licensePlate || 'Xe xuất kho',
            driverName: dto.driverName || 'Tài xế giao hàng',
            status: 'IN_TRANSIT',
            pickupDate: dispatchDate,
            quantityAllocated: qtyToExport,
            weightAllocated: weight,
            volumeAllocated: volume,
            notes: tripNotes,
          }),
        );

        // Dispatch invoice (Phiếu xuất luân chuyển / Phiếu giao khách)
        await txRepo.save(
          txRepo.create({
            orderId: order.id,
            type: isTransferLine
              ? InventoryTransactionType.TRANSFER
              : InventoryTransactionType.OUTBOUND,
            invoiceCode,
            hubId: actingHubId,
            tripId: createdTrip.id,
            tripCode,
            quantity: qtyToExport,
            expectedQuantity: qtyToExport,
            discrepancyQuantity: 0,
            remainingQuantity: hubStockAfter,
            weight,
            volume,
            licensePlate: dto.licensePlate || null,
            driverName: dto.driverName || null,
            destination: isTransferLine
              ? outboundTargetName
              : outboundDeliveryAddress ||
                order.destinationHub ||
                order.province ||
                'Giao khách',
            performedByUserId: user.id,
            notes: isTransferLine
              ? `Xuất ${qtyToExport} kiện luân chuyển đến ${outboundTargetName} trên chuyến ${tripCode}`
              : `Xuất ${qtyToExport} kiện giao khách trên chuyến ${tripCode}`,
          }),
        );
      }

      const saved = await orderRepo.save(orders);

      // Trip stops: origin "Đã xử lý"; every receiving hub on the route "Chờ xử lý"
      if (originHubId) {
        await this.ledgerService.upsertTripStop(
          {
            tripCode,
            hubId: originHubId,
            status: TripStopStatus.COMPLETED,
            stopType: TripStopType.ORIGIN,
            stopSequence: 1,
            userId: user.id,
          },
          manager,
        );
      }
      if (isTransfer) {
        const targets = Array.from(
          new Set(
            [
              dto.mode === OutboundMode.TRANSFER
                ? (dto.destinationHubId ?? null)
                : null,
              ...(dto.items
                ?.filter((i) => i.deliveryMode !== 'DIRECT_CUSTOMER')
                .map((i) => i.destinationHubId) ?? []),
              ...saved
                .filter((o) => !!o.destinationHubId)
                .map((o) => o.destinationHubId),
            ].filter((h): h is number => !!h && h !== originHubId),
          ),
        );
        for (let i = 0; i < targets.length; i++) {
          await this.ledgerService.upsertTripStop(
            {
              tripCode,
              hubId: targets[i],
              status: TripStopStatus.PENDING,
              stopType:
                i === targets.length - 1
                  ? TripStopType.DESTINATION
                  : TripStopType.TRANSIT,
              stopSequence: i + 2,
            },
            manager,
          );
        }
      }

      for (const ord of saved) {
        await this.activityLogService.safeLogActivity(
          {
            orderId: ord.id,
            orderCode: ord.orderCode,
            action: OrderActivityAction.OUTBOUND_CONFIRMED,
            actorUserId: Number(user?.id || 0),
            actorEmail: user?.email || undefined,
            hubId: Number(
              originHubId || ord.currentHubId || ord.originHubId || 0,
            ),
            hubName: ord.originHub || 'N/A Hub',
            tripCode: tripCode || null,
            quantity: ord.outboundQuantity ?? 0,
            reason: `Xác nhận xuất kho chuyến ${tripCode}${dto.licensePlate ? ` (xe ${dto.licensePlate})` : ''}`,
            newValues: {
              totalQuantity: ord.totalQuantity,
              inboundQuantity: ord.inboundQuantity,
              outboundQuantity: ord.outboundQuantity,
              remainingQuantity: ord.remainingQuantity,
              status: ord.status,
            },
          },
          manager,
        );
      }

      return {
        updatedCount: saved.length,
        orders: saved,
        trip: createdTrip,
        tripCode,
        invoiceCode,
      };
    });
  }

  /**
   * Validates that `tripCode` is an outbound draft of the acting hub (planned lines only, no
   * dispatch invoice yet) and soft-deletes its planned lines. Trip stops are kept so the caller
   * can either complete the origin stop (confirm) or drop it (cancel).
   */
  private async discardOutboundDraftLines(
    manager: EntityManager,
    tripCode: string,
    userHubId: number | null,
  ): Promise<TripEntity[]> {
    const tripRepo = manager.getRepository(TripEntity);
    const lines = await tripRepo.find({ where: { tripCode } });
    if (lines.length === 0) {
      throw new NotFoundException(`Không tìm thấy chuyến nháp ${tripCode}`);
    }
    const isDraft = lines.every(
      (t) =>
        t.status === 'PENDING' &&
        t.quantityAllocated !== null &&
        t.quantityAllocated !== undefined &&
        (t.type === 'OUTBOUND' || t.type === 'TRANSFER'),
    );
    const dispatched = await manager.query(
      `SELECT 1 FROM "order_inventory_transaction"
       WHERE "tripCode" = $1 AND "type" IN ('OUTBOUND', 'TRANSFER') AND "deletedAt" IS NULL LIMIT 1`,
      [tripCode],
    );
    if (!isDraft || dispatched.length > 0) {
      throw new UnprocessableEntityException(
        `Chuyến ${tripCode} đã xuất kho, không còn là phiếu nháp.`,
      );
    }
    if (userHubId && lines.some((t) => t.originHubId !== userHubId)) {
      throw new UnprocessableEntityException(
        `Chuyến nháp ${tripCode} không thuộc kho của bạn.`,
      );
    }
    await tripRepo.softDelete(lines.map((t) => t.id));
    return lines;
  }

  /**
   * Save an outbound note as a draft trip ("Chờ xử lý").
   * - Allocates (or keeps, when `draftTripCode` is given) one SD trip code.
   * - Stores planned lines (quantity / kg / m³) on `trip` rows; NO dispatch invoice is written,
   *   so hub stock and Master Contract fields are untouched.
   * - Origin trip stop of the acting hub = PENDING; receiving hubs get their stops on confirm.
   */
  async saveOutboundDraft(
    user: UserEntity,
    dto: ConfirmOutboundDto,
  ): Promise<{ tripCode: string; orderCount: number }> {
    const targetOrderIds =
      dto.items && dto.items.length > 0
        ? dto.items.map((i) => i.orderId)
        : dto.orderIds || [];
    if (targetOrderIds.length === 0) {
      throw new NotFoundException(
        'Vui lòng chọn ít nhất 1 dòng hàng để lưu nháp',
      );
    }

    const userHubId = (await this.resolveUserHubId(user)) ?? null;

    return this.dataSource.transaction(async (manager) => {
      const orderRepo = manager.getRepository(OrderEntity);
      const tripRepo = manager.getRepository(TripEntity);

      const rawOrders = await orderRepo.find({
        where: { id: In(targetOrderIds) },
      });
      if (rawOrders.length === 0) {
        throw new NotFoundException('Không tìm thấy đơn hàng nào để lưu nháp');
      }

      const draftCode = normalizeTripCode(dto.draftTripCode);
      if (draftCode) {
        await this.discardOutboundDraftLines(manager, draftCode, userHubId);
      }

      const orders: OrderEntity[] = [];
      const seenCodes = new Set<string>();
      for (const ro of rawOrders) {
        if (ro.orderCode && seenCodes.has(ro.orderCode)) continue;
        if (ro.orderCode) seenCodes.add(ro.orderCode);
        const consolidated = await this.consolidateSiblingOrdersByCode(
          manager,
          ro,
        );
        orders.push(consolidated);
      }

      const tripCode =
        draftCode || (await this.ledgerService.generateTripCode(manager));

      const actingOriginId =
        userHubId ?? orders[0].currentHubId ?? orders[0].originHubId ?? null;
      const isTransferMode = dto.mode === OutboundMode.TRANSFER;
      const dispatchDate =
        dto.dispatchDate || new Date().toISOString().split('T')[0];

      for (const order of orders) {
        const item = this.mergeOutboundItemsForOrder(dto.items, order);
        const actingHubId =
          userHubId ?? order.currentHubId ?? order.originHubId ?? null;
        const isDraft = DRAFT_LIKE_STATUSES.includes(order.status);
        const hubStock =
          !isDraft && actingHubId
            ? await this.ledgerService.getHubStock(
                order.id,
                actingHubId,
                manager,
              )
            : null;
        const availableQty = isDraft
          ? (order.remainingQuantity ?? order.totalQuantity ?? 0)
          : hubStock !== null
            ? hubStock
            : (order.remainingQuantity ?? order.totalQuantity ?? 0);
        const pendingAlloc =
          await this.ledgerService.getPendingOutboundAllocation(
            order.id,
            actingHubId,
            draftCode || undefined,
            manager,
          );
        const effectiveAvailable = Math.max(
          0,
          availableQty - pendingAlloc.pendingQty,
        );

        const qty =
          item?.quantityToExport !== undefined
            ? Number(item.quantityToExport)
            : effectiveAvailable;
        if (qty <= 0) {
          throw new UnprocessableEntityException(
            `Đơn hàng ${order.orderCode}: Số lượng xuất phải lớn hơn 0.`,
          );
        }
        if (qty > effectiveAvailable) {
          const tripHint =
            pendingAlloc.tripCodes.length > 0
              ? ` (${pendingAlloc.tripCodes.join(', ')})`
              : '';
          throw new UnprocessableEntityException(
            `Mã đơn ${order.orderCode}: Không thể thêm vào chuyến xe này. Đơn hàng đã được xếp ${pendingAlloc.pendingQty}/${availableQty} kiện vào chuyến xe chờ xuất${tripHint}. Số kiện khả dụng còn lại: ${effectiveAvailable} kiện.`,
          );
        }

        const isLineDirectCustomer =
          item?.deliveryMode === 'DIRECT_CUSTOMER' ||
          (!item?.destinationHubId &&
            item?.deliveryMode !== 'HUB_L1' &&
            item?.deliveryMode !== 'XE_BO' &&
            !isTransferMode);

        const destHubId = isLineDirectCustomer
          ? null
          : (item?.destinationHubId ??
            (isTransferMode ? dto.destinationHubId : null) ??
            null);
        const tripDestHubId =
          destHubId && destHubId !== actingHubId ? destHubId : null;
        const isTransferLine =
          !isLineDirectCustomer && (isTransferMode || !!tripDestHubId);

        let orderChanged = false;
        if (item?.notes !== undefined) {
          order.notes = item.notes.trim() || null;
          orderChanged = true;
        }
        if (item?.accompanyingDocs !== undefined) {
          order.accompanyingDocs = item.accompanyingDocs.trim() || null;
          orderChanged = true;
        }
        if (item?.province !== undefined) {
          order.province = item.province.trim() || null;
          orderChanged = true;
        }
        if (isDraft) {
          if (item?.goodsDescription && item.goodsDescription.trim()) {
            order.goodsDescription = item.goodsDescription.trim();
            orderChanged = true;
          }
          if (item?.pickupAddress && item.pickupAddress.trim()) {
            order.originHub = item.pickupAddress.trim();
            orderChanged = true;
          }
        }
        if (orderChanged) {
          await orderRepo.save(order);
        }

        const customDraftAddr = item?.deliveryAddress?.trim() || '';
        const draftAddrSuffix = customDraftAddr
          ? ` | ĐC: ${customDraftAddr}`
          : '';

        await tripRepo.save(
          tripRepo.create({
            orderId: order.id,
            tripCode,
            originHubId: actingHubId ?? actingOriginId,
            destinationHubId: tripDestHubId,
            type: isTransferLine ? 'TRANSFER' : 'OUTBOUND',
            licensePlate: dto.licensePlate?.trim() || null,
            driverName: dto.driverName?.trim() || null,
            status: 'PENDING',
            pickupDate: dispatchDate,
            quantityAllocated: qty,
            weightAllocated: Number(
              item?.weightToExport ??
                this.proportional(order.totalWeight, qty, order.totalQuantity),
            ),
            volumeAllocated: Number(
              item?.volumeToExport ??
                this.proportional(order.totalVolume, qty, order.totalQuantity),
            ),
            notes: isTransferLine
              ? `[NHÁP XUẤT KHO - LUÂN CHUYỂN] Dự kiến xuất ${qty} kiện${draftAddrSuffix}`
              : `[NHÁP XUẤT KHO - GIAO KHÁCH] Dự kiến xuất ${qty} kiện${draftAddrSuffix}`,
          }),
        );
      }

      if (actingOriginId) {
        await this.ledgerService.upsertTripStop(
          {
            tripCode,
            hubId: actingOriginId,
            status: TripStopStatus.PENDING,
            stopType: TripStopType.ORIGIN,
            stopSequence: 1,
            userId: user.id,
          },
          manager,
        );
      }

      const draftTargets = Array.from(
        new Set(
          [
            ...(dto.items
              ?.filter((i) => i.deliveryMode !== 'DIRECT_CUSTOMER')
              .map((i) => i.destinationHubId) ?? []),
            isTransferMode ? (dto.destinationHubId ?? null) : null,
          ].filter((h): h is number => !!h && h !== actingOriginId),
        ),
      );
      for (let i = 0; i < draftTargets.length; i++) {
        await this.ledgerService.upsertTripStop(
          {
            tripCode,
            hubId: draftTargets[i],
            status: TripStopStatus.PENDING,
            stopType:
              i === draftTargets.length - 1
                ? TripStopType.DESTINATION
                : TripStopType.TRANSIT,
            stopSequence: i + 2,
          },
          manager,
        );
      }

      return { tripCode, orderCount: orders.length };
    });
  }

  /** Cancel an outbound draft trip: drops its planned lines and its trip stops. */
  async cancelOutboundDraft(
    user: UserEntity,
    tripCodeParam: string,
  ): Promise<{ tripCode: string; cancelled: boolean }> {
    const tripCode = normalizeTripCode(decodeURIComponent(tripCodeParam || ''));
    if (!tripCode) {
      throw new NotFoundException('Không tìm thấy chuyến nháp');
    }
    const userHubId = (await this.resolveUserHubId(user)) ?? null;
    await this.dataSource.transaction(async (manager) => {
      const droppedLines = await this.discardOutboundDraftLines(
        manager,
        tripCode,
        userHubId,
      );
      await manager.query(
        `UPDATE "trip_stop" SET "deletedAt" = NOW()
         WHERE "tripCode" = $1 AND "status" = 'PENDING' AND "deletedAt" IS NULL`,
        [tripCode],
      );
      const orderIds = Array.from(
        new Set(droppedLines.map((l) => l.orderId).filter(Boolean)),
      );
      if (orderIds.length > 0) {
        const affectedOrders = await manager
          .getRepository(OrderEntity)
          .find({ where: { id: In(orderIds) } });
        for (const ord of affectedOrders) {
          await this.activityLogService.safeLogActivity(
            {
              orderId: ord.id,
              orderCode: ord.orderCode,
              action: OrderActivityAction.DRAFT_CANCELLED,
              actorUserId: Number(user?.id || 0),
              actorEmail: user?.email || undefined,
              hubId: Number(
                userHubId || ord.currentHubId || ord.originHubId || 0,
              ),
              hubName: ord.originHub || 'N/A Hub',
              tripCode,
              quantity: ord.remainingQuantity ?? 0,
              reason: `Hủy chuyến nháp xuất kho ${tripCode}`,
            },
            manager,
          );
        }
      }
    });
    return { tripCode, cancelled: true };
  }

  /** Cancel an inbound draft trip: soft-deletes its pending trip stops and pending draft orders. */
  async cancelInboundDraft(
    user: UserEntity,
    tripCodeParam: string,
  ): Promise<{ tripCode: string; cancelled: boolean }> {
    const tripCode = normalizeTripCode(decodeURIComponent(tripCodeParam || ''));
    if (!tripCode) {
      throw new NotFoundException('Không tìm thấy chuyến nháp');
    }
    const userHubId = (await this.resolveUserHubId(user)) ?? null;
    const existingStops = await this.dataSource.query(
      `SELECT 1 FROM "trip_stop"
       WHERE "tripCode" = $1 AND "status" = 'PENDING' AND "deletedAt" IS NULL
       ${userHubId ? 'AND "hubId" = $2' : ''} LIMIT 1`,
      userHubId ? [tripCode, userHubId] : [tripCode],
    );
    const existingTrips = await this.dataSource.query(
      `SELECT 1 FROM "trip"
       WHERE "tripCode" = $1 AND "status" = 'PENDING' AND "deletedAt" IS NULL LIMIT 1`,
      [tripCode],
    );
    if (existingStops.length === 0 && existingTrips.length === 0) {
      throw new NotFoundException(`Không tìm thấy chuyến nháp ${tripCode}`);
    }

    await this.dataSource.transaction(async (manager) => {
      if (userHubId) {
        await manager.query(
          `UPDATE "trip_stop" SET "deletedAt" = NOW()
           WHERE "tripCode" = $1 AND "hubId" = $2 AND "status" = 'PENDING' AND "deletedAt" IS NULL`,
          [tripCode, userHubId],
        );
      } else {
        await manager.query(
          `UPDATE "trip_stop" SET "deletedAt" = NOW()
           WHERE "tripCode" = $1 AND "status" = 'PENDING' AND "deletedAt" IS NULL`,
          [tripCode],
        );
      }

      await manager.query(
        `UPDATE "order" SET "deletedAt" = NOW()
         WHERE id IN (SELECT t."orderId" FROM "trip" t WHERE t."tripCode" = $1)
           AND "status" IN ('DRAFT', 'PENDING')
           AND "deletedAt" IS NULL`,
        [tripCode],
      );

      await manager.query(
        `UPDATE "trip" SET "deletedAt" = NOW()
         WHERE "tripCode" = $1 AND "status" = 'PENDING' AND "deletedAt" IS NULL`,
        [tripCode],
      );
    });
    return { tripCode, cancelled: true };
  }

  /**
   * Get KPI metrics for warehouse dashboard cards & tab counters (hub-scoped statuses).
   */
  async getKpiStats(
    user: UserEntity,
    query?: {
      fromDate?: string;
      toDate?: string;
    },
  ): Promise<{
    total: number;
    inboundTotal: number;
    outboundTotal: number;
    waitingInbound: number;
    customerInbound: number;
    transferInbound: number;
    storedInbound: number;
    waitingOutbound: number;
    customerOutbound: number;
    transferOutbound: number;
    completedOutboundToday: number;
    completedOutbound: number;
  }> {
    const { userHubId, useHubContext } = await this.resolveHubContext(user);
    const statusExpr = useHubContext
      ? this.ledgerService.hubStatusSql()
      : 'order.status';

    const qb = this.orderRepository
      .createQueryBuilder('order')
      .where('order.deletedAt IS NULL');

    if (useHubContext) {
      qb.andWhere(this.ledgerService.hubScopeSql()).setParameter(
        'userHubId',
        userHubId,
      );
    }

    if (query?.fromDate) {
      const from = new Date(`${query.fromDate}T00:00:00`);
      qb.andWhere(
        '(order.createdAt >= :fromDate OR order.updatedAt >= :fromDate)',
        {
          fromDate: from.toISOString(),
        },
      );
    }

    if (query?.toDate) {
      const to = new Date(`${query.toDate}T23:59:59.999`);
      qb.andWhere(
        '(order.createdAt <= :toDate OR order.updatedAt <= :toDate)',
        {
          toDate: to.toISOString(),
        },
      );
    }

    const [baseSql, params] = qb
      .select(statusExpr, 'hs')
      .addSelect(
        `CASE WHEN ${TRANSFER_INBOUND_SQL} THEN 1 ELSE 0 END`,
        'isTransferIn',
      )
      .addSelect(
        `CASE WHEN ${TRANSFER_OUTBOUND_SQL} THEN 1 ELSE 0 END`,
        'isTransferOut',
      )
      .getQueryAndParameters();

    const aggSql = `
      WITH base AS MATERIALIZED (
        ${baseSql}
      )
      SELECT
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE "hs" IN (${sqlList(WAITING_STATUSES)}))::int AS "waitingInbound",
        COUNT(*) FILTER (WHERE "hs" IN (${sqlList(WAITING_STATUSES)}) AND "isTransferIn" = 0)::int AS "customerInbound",
        COUNT(*) FILTER (WHERE "hs" IN (${sqlList(WAITING_STATUSES)}) AND "isTransferIn" = 1)::int AS "transferInbound",
        COUNT(*) FILTER (WHERE "hs" IN (${sqlList(STORED_STATUSES)}))::int AS "storedInbound",
        COUNT(*) FILTER (WHERE "hs" IN (${sqlList(STORED_STATUSES)}) AND "isTransferOut" = 0)::int AS "customerOutbound",
        COUNT(*) FILTER (WHERE "hs" IN (${sqlList(STORED_STATUSES)}) AND "isTransferOut" = 1)::int AS "transferOutbound",
        COUNT(*) FILTER (WHERE "hs" IN (${sqlList(DISPATCHED_STATUSES)}))::int AS "completedOutbound"
      FROM base
    `;

    const aggRows = await this.dataSource.query(aggSql, params);
    const row = aggRows?.[0] || {};

    const waitingInbound = Number(row.waitingInbound) || 0;
    const customerInbound = Number(row.customerInbound) || 0;
    const transferInbound = Number(row.transferInbound) || 0;
    const storedInbound = Number(row.storedInbound) || 0;
    const customerOutbound = Number(row.customerOutbound) || 0;
    const transferOutbound = Number(row.transferOutbound) || 0;
    const completedOutbound = Number(row.completedOutbound) || 0;
    const total = Number(row.total) || 0;

    const inboundTotal = waitingInbound + storedInbound;
    const outboundTotal = storedInbound + completedOutbound;

    return {
      total,
      inboundTotal,
      outboundTotal,
      waitingInbound,
      customerInbound,
      transferInbound,
      storedInbound,
      waitingOutbound: storedInbound,
      customerOutbound,
      transferOutbound,
      completedOutbound,
      completedOutboundToday: completedOutbound,
    };
  }

  /**
   * Outbound board: logical trips (SD...) of the viewer hub, one row per trip.
   *  - Đã xử lý (COMPLETED): dispatched — OUTBOUND/TRANSFER invoices issued by this hub.
   *  - Chờ xử lý (PENDING): saved draft — planned lines on `trip` (quantityAllocated), no invoice.
   * A trip is "Luân chuyển" when any line is a TRANSFER, otherwise "Xuất khách".
   * Status tab counters (all / pending / completed), type sub-filter counters (customer / transfer)
   * and rows all come from the same CTE (1:1 parity with what is rendered).
   * Date range applies to the dispatch time (or draft save time) at this hub.
   */
  async getOutboundTrips(
    user: UserEntity,
    query: {
      search?: string;
      status?: string;
      type?: string;
      fromDate?: string;
      toDate?: string;
      page?: number;
      limit?: number;
    },
  ): Promise<{ data: any[]; meta: any }> {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query?.limit) || 20));
    const skip = (page - 1) * limit;

    const { userHubId, useHubContext } = await this.resolveHubContext(user);
    const params: any[] = [];
    const bind = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };

    const dispatchTypes = `('${InventoryTransactionType.OUTBOUND}', '${InventoryTransactionType.TRANSFER}')`;
    const txWhere: string[] = [
      `tx."deletedAt" IS NULL`,
      `tx."type" IN ${dispatchTypes}`,
      `tx."tripCode" IS NOT NULL`,
      `tx."tripCode" <> ''`,
      `o."deletedAt" IS NULL`,
    ];
    const draftWhere: string[] = [
      `t."deletedAt" IS NULL`,
      `o."deletedAt" IS NULL`,
      `t."status" = 'PENDING'`,
      `t."type" IN ('OUTBOUND', 'TRANSFER')`,
      `t."quantityAllocated" IS NOT NULL`,
      `t."tripCode" IS NOT NULL`,
      `t."tripCode" <> ''`,
      `NOT EXISTS (SELECT 1 FROM "order_inventory_transaction" dtx WHERE dtx."tripCode" = t."tripCode" AND dtx."type" IN ${dispatchTypes} AND dtx."deletedAt" IS NULL)`,
    ];

    if (useHubContext && userHubId) {
      const p = bind(userHubId);
      txWhere.push(`tx."hubId" = ${p}`);
      draftWhere.push(`t."originHubId" = ${p}`);
    }
    if (query?.search && query.search.trim()) {
      const p = bind(`%${query.search.trim()}%`);
      txWhere.push(
        `(tx."tripCode" ILIKE ${p} OR tx."licensePlate" ILIKE ${p} OR tx."driverName" ILIKE ${p} OR o."orderCode" ILIKE ${p} OR o."goodsDescription" ILIKE ${p} OR EXISTS (SELECT 1 FROM "trip" st WHERE st."tripCode" = tx."tripCode" AND st."deletedAt" IS NULL AND (st."licensePlate" ILIKE ${p} OR st."driverName" ILIKE ${p})))`,
      );
      draftWhere.push(
        `(t."tripCode" ILIKE ${p} OR t."licensePlate" ILIKE ${p} OR t."driverName" ILIKE ${p} OR o."orderCode" ILIKE ${p} OR o."goodsDescription" ILIKE ${p})`,
      );
    }
    if (query?.fromDate) {
      const p = bind(new Date(`${query.fromDate}T00:00:00`).toISOString());
      txWhere.push(`tx."createdAt" >= ${p}`);
      draftWhere.push(`t."createdAt" >= ${p}`);
    }
    if (query?.toDate) {
      const p = bind(new Date(`${query.toDate}T23:59:59.999`).toISOString());
      txWhere.push(`tx."createdAt" <= ${p}`);
      draftWhere.push(`t."createdAt" <= ${p}`);
    }

    const groupedCte = `WITH base AS (
        SELECT tx."tripCode" AS "tripCode",
               (tx."type" = '${InventoryTransactionType.TRANSFER}') AS "isTransfer",
               tx."createdAt" AS "at",
               'COMPLETED' AS "status"
        FROM "order_inventory_transaction" tx
        JOIN "order" o ON o.id = tx."orderId"
        WHERE ${txWhere.join(' AND ')}
        UNION ALL
        SELECT t."tripCode", (t."type" = 'TRANSFER'), t."createdAt", 'PENDING'
        FROM "trip" t
        JOIN "order" o ON o.id = t."orderId"
        WHERE ${draftWhere.join(' AND ')}
      ), g AS (
        SELECT "tripCode",
               BOOL_OR("isTransfer") AS "isTransfer",
               MAX("at") AS "dispatchedAt",
               MIN("status") AS "status"
        FROM base
        GROUP BY "tripCode"
      )`;

    const statusUpper = query?.status?.toUpperCase();
    const statusCond =
      statusUpper === 'PENDING' || statusUpper === 'COMPLETED'
        ? `g."status" = '${statusUpper}'`
        : 'TRUE';
    const typeUpper = query?.type?.toUpperCase();
    const typeCond =
      typeUpper === 'CUSTOMER'
        ? 'NOT g."isTransfer"'
        : typeUpper === 'TRANSFER'
          ? 'g."isTransfer"'
          : 'TRUE';

    const countRows = await this.dataSource.query(
      `${groupedCte}
       SELECT COUNT(*) FILTER (WHERE ${typeCond})::int AS "allCount",
              COUNT(*) FILTER (WHERE g."status" = 'PENDING' AND ${typeCond})::int AS "pendingCount",
              COUNT(*) FILTER (WHERE g."status" = 'COMPLETED' AND ${typeCond})::int AS "completedCount",
              COUNT(*) FILTER (WHERE ${statusCond})::int AS "typeAllCount",
              COUNT(*) FILTER (WHERE NOT g."isTransfer" AND ${statusCond})::int AS "customerCount",
              COUNT(*) FILTER (WHERE g."isTransfer" AND ${statusCond})::int AS "transferCount",
              COUNT(*) FILTER (WHERE ${statusCond} AND ${typeCond})::int AS "total"
       FROM g`,
      params,
    );
    const c = countRows?.[0] ?? {};
    const total = Number(c.total) || 0;
    const meta = {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      allCount: Number(c.allCount) || 0,
      pendingCount: Number(c.pendingCount) || 0,
      completedCount: Number(c.completedCount) || 0,
      typeAllCount: Number(c.typeAllCount) || 0,
      customerCount: Number(c.customerCount) || 0,
      transferCount: Number(c.transferCount) || 0,
    };

    const pageRows: Array<{
      tripCode: string;
      isTransfer: boolean;
      dispatchedAt: string;
      status: 'PENDING' | 'COMPLETED';
    }> = await this.dataSource.query(
      `${groupedCte}
       SELECT g."tripCode", g."isTransfer", g."dispatchedAt", g."status"
       FROM g
       WHERE ${statusCond} AND ${typeCond}
       ORDER BY CASE WHEN g."status" = 'PENDING' THEN 0 ELSE 1 END,
                g."dispatchedAt" DESC, g."tripCode" DESC
       LIMIT ${limit} OFFSET ${skip}`,
      params,
    );
    if (pageRows.length === 0) {
      return { data: [], meta };
    }

    const completedCodes = pageRows
      .filter((r) => r.status === 'COMPLETED')
      .map((r) => r.tripCode);
    const pendingCodes = pageRows
      .filter((r) => r.status === 'PENDING')
      .map((r) => r.tripCode);

    // Dispatch invoices of the page's dispatched trips at the viewer hub
    let dispatchTxs: OrderInventoryTransactionEntity[] = [];
    if (completedCodes.length > 0) {
      const txQb = this.transactionRepository
        .createQueryBuilder('tx')
        .leftJoinAndSelect('tx.hub', 'hub')
        .where('tx.deletedAt IS NULL')
        .andWhere('tx.type IN (:...types)', {
          types: [
            InventoryTransactionType.OUTBOUND,
            InventoryTransactionType.TRANSFER,
          ],
        })
        .andWhere('tx.tripCode IN (:...completedCodes)', { completedCodes })
        .orderBy('tx.id', 'ASC');
      if (useHubContext && userHubId) {
        txQb.andWhere('tx.hubId = :userHubId', { userHubId });
      }
      dispatchTxs = await txQb.getMany();
    }

    // Planned lines of the page's draft trips
    const draftLines =
      pendingCodes.length > 0
        ? await this.tripRepository
            .createQueryBuilder('t')
            .leftJoinAndSelect('t.originHub', 'draftOriginHub')
            .leftJoinAndSelect('t.destinationHub', 'draftDestinationHub')
            .where('t.deletedAt IS NULL')
            .andWhere('t.tripCode IN (:...pendingCodes)', { pendingCodes })
            .andWhere(`t.status = 'PENDING'`)
            .andWhere('t.quantityAllocated IS NOT NULL')
            .orderBy('t.id', 'ASC')
            .getMany()
        : [];

    const orderIds = Array.from(
      new Set([
        ...dispatchTxs.map((t) => t.orderId),
        ...draftLines.map((t) => t.orderId),
      ]),
    );
    let orderEntities: OrderEntity[] = [];
    if (orderIds.length > 0) {
      const [orders, trips, txs] = await Promise.all([
        this.orderRepository
          .createQueryBuilder('order')
          .leftJoinAndSelect('order.originHubEntity', 'originHubEntity')
          .leftJoinAndSelect(
            'order.destinationHubEntity',
            'destinationHubEntity',
          )
          .leftJoinAndSelect('order.currentHubEntity', 'currentHubEntity')
          .where('order.deletedAt IS NULL')
          .andWhere('order.id IN (:...orderIds)', { orderIds })
          .getMany(),
        this.tripRepository
          .createQueryBuilder('t')
          .leftJoinAndSelect('t.originHub', 'tripOriginHub')
          .leftJoinAndSelect('t.destinationHub', 'tripDestinationHub')
          .where('t.deletedAt IS NULL')
          .andWhere('t.orderId IN (:...orderIds)', { orderIds })
          .getMany(),
        this.transactionRepository
          .createQueryBuilder('tx')
          .leftJoinAndSelect('tx.hub', 'inventoryTransactionHub')
          .where('tx.deletedAt IS NULL')
          .andWhere('tx.orderId IN (:...orderIds)', { orderIds })
          .getMany(),
      ]);

      const tripsByOrderId = new Map<number, TripEntity[]>();
      for (const t of trips) {
        const list = tripsByOrderId.get(t.orderId) || [];
        list.push(t);
        tripsByOrderId.set(t.orderId, list);
      }

      const txsByOrderId = new Map<number, OrderInventoryTransactionEntity[]>();
      for (const tx of txs) {
        const list = txsByOrderId.get(tx.orderId) || [];
        list.push(tx);
        txsByOrderId.set(tx.orderId, list);
      }

      for (const order of orders) {
        order.trips = tripsByOrderId.get(order.id) || [];
        order.inventoryTransactions = txsByOrderId.get(order.id) || [];
      }
      orderEntities = orders;
    }
    const enriched = await this.enrichWarehouseRows(
      orderEntities,
      userHubId,
      useHubContext,
    );
    const orderById = new Map<number, any>(
      enriched.map((o) => [Number(o.id), o]),
    );

    const data = pageRows.map((row) => {
      const isDraft = row.status === 'PENDING';
      const sourceLines: Array<{
        orderId: number;
        quantity: number;
        weight: number;
        volume: number;
        invoiceCode: string | null;
        destinationHubId: number | null;
        destinationHubEntity: any | null;
        outboundDestination: string | null;
      }> = isDraft
        ? draftLines
            .filter((t) => t.tripCode === row.tripCode)
            .map((t) => {
              const hubObj = (t as any).destinationHub;
              const hubLabel = hubObj?.name
                ? hubObj.address && !hubObj.name.includes(hubObj.address)
                  ? `${hubObj.name} — ${hubObj.address}`
                  : hubObj.name
                : null;
              const noteAddr = t.notes?.includes(' | ĐC: ')
                ? t.notes.split(' | ĐC: ')[1]?.trim() || null
                : null;
              return {
                orderId: t.orderId,
                quantity: Number(t.quantityAllocated) || 0,
                weight: Number(t.weightAllocated) || 0,
                volume: Number(t.volumeAllocated) || 0,
                invoiceCode: null,
                destinationHubId: t.destinationHubId ?? null,
                destinationHubEntity: hubObj ?? null,
                outboundDestination: hubLabel || noteAddr || null,
              };
            })
        : dispatchTxs
            .filter((t) => t.tripCode === row.tripCode)
            .map((t) => ({
              orderId: t.orderId,
              quantity: Number(t.quantity) || 0,
              weight: Number(t.weight) || 0,
              volume: Number(t.volume) || 0,
              invoiceCode: t.invoiceCode,
              destinationHubId: null,
              destinationHubEntity: null,
              outboundDestination: t.destination ?? null,
            }));

      const orders: any[] = [];
      let totalQuantity = 0;
      let totalWeight = 0;
      let totalVolume = 0;
      for (const line of sourceLines) {
        totalQuantity += line.quantity;
        totalWeight += line.weight;
        totalVolume += line.volume;
        const order = orderById.get(Number(line.orderId));
        if (!order) continue;
        const basePendingQty = Number(order.pendingOutboundQuantity) || 0;
        const basePendingTripCodes: string[] =
          order.pendingOutboundTripCodes || [];
        const thisTripQty = isDraft ? line.quantity : 0;
        const adjustedPendingTripCodes = basePendingTripCodes.filter(
          (tc) => tc !== row.tripCode,
        );
        const adjustedPendingQty = Math.max(0, basePendingQty - thisTripQty);
        const adjustedEffectiveHubStock =
          order.effectiveHubStock !== null &&
          order.effectiveHubStock !== undefined
            ? Number(order.effectiveHubStock) + thisTripQty
            : null;
        const adjustedEffectiveStock =
          order.effectiveStock !== null && order.effectiveStock !== undefined
            ? Number(order.effectiveStock) + thisTripQty
            : null;

        const existing = orders.find((x) => x.id === order.id);
        if (existing) {
          existing.exportedQuantity += line.quantity;
          existing.exportedWeight += line.weight;
          existing.exportedVolume += line.volume;
          if (isDraft) {
            existing.effectiveHubStock =
              existing.effectiveHubStock !== null &&
              existing.effectiveHubStock !== undefined
                ? Number(existing.effectiveHubStock) + line.quantity
                : null;
            existing.effectiveStock =
              existing.effectiveStock !== null &&
              existing.effectiveStock !== undefined
                ? Number(existing.effectiveStock) + line.quantity
                : null;
            existing.pendingOutboundQuantity = Math.max(
              0,
              (Number(existing.pendingOutboundQuantity) || 0) - line.quantity,
            );
          }
          continue;
        }
        const matchedTrip = (order.trips ?? []).find(
          (tr: any) => tr?.tripCode === row.tripCode,
        );
        const resolvedTripDestHubEntity = isDraft
          ? (line.destinationHubEntity ?? null)
          : (line.destinationHubEntity ?? matchedTrip?.destinationHub ?? null);
        const resolvedTripDestHubId = isDraft
          ? (line.destinationHubId ?? null)
          : (line.destinationHubId ?? matchedTrip?.destinationHubId ?? null);
        const tripHubLabel = resolvedTripDestHubEntity?.name
          ? resolvedTripDestHubEntity.address &&
            !resolvedTripDestHubEntity.name.includes(
              resolvedTripDestHubEntity.address,
            )
            ? `${resolvedTripDestHubEntity.name} — ${resolvedTripDestHubEntity.address}`
            : resolvedTripDestHubEntity.name
          : null;
        const resolvedOutboundDestination =
          tripHubLabel || line.outboundDestination || null;
        const isXeBoDest =
          resolvedTripDestHubEntity?.level === 2 ||
          resolvedTripDestHubEntity?.code?.startsWith('XB-') ||
          resolvedTripDestHubEntity?.code?.startsWith('HUB-BO-') ||
          resolvedTripDestHubEntity?.name?.toLowerCase().includes('xe bo');
        const resolvedDeliveryMode = resolvedTripDestHubId
          ? isXeBoDest
            ? 'XE_BO'
            : 'HUB_L1'
          : 'DIRECT_CUSTOMER';

        orders.push({
          ...order,
          exportedQuantity: line.quantity,
          exportedWeight: line.weight,
          exportedVolume: line.volume,
          dispatchInvoiceCode: line.invoiceCode,
          plannedDestinationHubId: resolvedTripDestHubId,
          outboundDestinationHubEntity: resolvedTripDestHubEntity,
          outboundDestination: resolvedOutboundDestination,
          deliveryMode: resolvedDeliveryMode,
          pendingOutboundTripCodes: adjustedPendingTripCodes,
          pendingOutboundQuantity: adjustedPendingQty,
          effectiveHubStock: adjustedEffectiveHubStock,
          effectiveStock: adjustedEffectiveStock,
        });
      }

      const firstDraft = isDraft
        ? draftLines.find((t) => t.tripCode === row.tripCode)
        : undefined;
      const firstTx = isDraft
        ? undefined
        : dispatchTxs.find((t) => t.tripCode === row.tripCode);
      const tripRecord =
        firstDraft ??
        orders
          .flatMap((o) => o.trips ?? [])
          .find((t: any) => t?.tripCode === row.tripCode);

      return {
        tripCode: row.tripCode,
        type: row.isTransfer ? 'TRANSFER' : 'CUSTOMER',
        isTransfer: !!row.isTransfer,
        isDraft,
        /** Status of this trip at the dispatching hub: PENDING = Chờ xử lý (nháp), COMPLETED = Đã xử lý. */
        status: row.status,
        licensePlate: tripRecord?.licensePlate || firstTx?.licensePlate || '',
        driverName: tripRecord?.driverName || firstTx?.driverName || '',
        dispatchDate: tripRecord?.pickupDate || row.dispatchedAt,
        dispatchedAt: row.dispatchedAt,
        invoiceCode: firstTx?.invoiceCode || null,
        destinationHubId: firstDraft?.destinationHubId ?? null,
        dispatchHubId: firstTx?.hubId ?? firstDraft?.originHubId ?? null,
        dispatchHubName:
          firstTx?.hub?.name || firstDraft?.originHub?.name || '',
        totalQuantity,
        totalWeight: Math.round(totalWeight * 1000) / 1000,
        totalVolume: Math.round(totalVolume * 1000) / 1000,
        notes: isDraft ? '' : tripRecord?.notes || '',
        orders,
      };
    });

    return { data, meta };
  }

  /**
   * List logical trips (grouped by SD trip code) that stop at the current hub,
   * with the hub-scoped trip status: PENDING (Chờ xử lý) / COMPLETED (Đã xử lý).
   */
  /**
   * List inbound trips stopping at the viewer hub with per-hub status (PENDING = Chờ xử lý, COMPLETED = Đã xử lý)
   * and source classification (CUSTOMER = Khách gửi trực tiếp, TRANSFER = Luân chuyển liên Hub).
   * Backed by trip_stop CTE query for 1:1 counter parity.
   */
  async getInboundTrips(
    user: UserEntity,
    query: {
      search?: string;
      status?: string;
      type?: string;
      fromDate?: string;
      toDate?: string;
      page?: number;
      limit?: number;
    },
  ): Promise<{ data: any[]; meta: any }> {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.max(1, Math.min(50, Number(query?.limit) || 15));
    const skip = (page - 1) * limit;

    const userHubId = (await this.resolveUserHubId(user)) ?? null;
    const params: any[] = [];
    const bind = (v: any) => {
      params.push(v);
      return `$${params.length}`;
    };

    const where: string[] = [
      `ts."deletedAt" IS NULL`,
      `ts."stopType" <> 'ORIGIN'`,
    ];

    if (userHubId) {
      where.push(`ts."hubId" = ${bind(userHubId)}`);
    }

    if (query?.search && query.search.trim()) {
      const p = bind(`%${query.search.trim()}%`);
      where.push(
        `(ts."tripCode" ILIKE ${p} OR EXISTS (SELECT 1 FROM "trip" st WHERE st."tripCode" = ts."tripCode" AND st."deletedAt" IS NULL AND (st."licensePlate" ILIKE ${p} OR st."driverName" ILIKE ${p})) OR EXISTS (SELECT 1 FROM "trip" st JOIN "order" so ON so.id = st."orderId" WHERE st."tripCode" = ts."tripCode" AND st."deletedAt" IS NULL AND (so."orderCode" ILIKE ${p} OR so."goodsDescription" ILIKE ${p})))`,
      );
    }

    if (query?.fromDate) {
      const fromIso = new Date(`${query.fromDate}T00:00:00`).toISOString();
      where.push(`ts."createdAt" >= ${bind(fromIso)}`);
    }

    if (query?.toDate) {
      const toIso = new Date(`${query.toDate}T23:59:59.999`).toISOString();
      where.push(`ts."createdAt" <= ${bind(toIso)}`);
    }

    const whereSql = where.join(' AND ');

    const baseCte = `WITH base AS (
      SELECT ts."tripCode",
             ts."status",
             ts."hubId",
             ts."createdAt",
             (
               CASE
                 WHEN ts."stopType" = 'TRANSIT' THEN TRUE
                 WHEN EXISTS (SELECT 1 FROM "trip" t WHERE t."tripCode" = ts."tripCode" AND t."type" = 'TRANSFER' AND t."deletedAt" IS NULL) THEN TRUE
                 WHEN (SELECT COUNT(DISTINCT all_ts."hubId") FROM "trip_stop" all_ts WHERE all_ts."tripCode" = ts."tripCode" AND all_ts."deletedAt" IS NULL) > 1 THEN TRUE
                 ELSE FALSE
               END
             ) AS "isTransfer"
      FROM "trip_stop" ts
      WHERE ${whereSql}
    )`;

    const statusUpper = query?.status?.toUpperCase();
    const statusCond =
      statusUpper === 'PENDING' || statusUpper === 'COMPLETED'
        ? `b."status" = '${statusUpper}'`
        : 'TRUE';
    const typeUpper = query?.type?.toUpperCase();
    const typeCond =
      typeUpper === 'CUSTOMER'
        ? 'NOT b."isTransfer"'
        : typeUpper === 'TRANSFER'
          ? 'b."isTransfer"'
          : 'TRUE';

    const countRows = await this.dataSource.query(
      `${baseCte}
       SELECT
         COUNT(*)::int AS "allCount",
         COUNT(*) FILTER (WHERE b."status" = 'PENDING')::int AS "pendingCount",
         COUNT(*) FILTER (WHERE b."status" = 'COMPLETED')::int AS "completedCount",
         COUNT(*) FILTER (WHERE ${statusCond})::int AS "typeAllCount",
         COUNT(*) FILTER (WHERE NOT b."isTransfer" AND ${statusCond})::int AS "customerCount",
         COUNT(*) FILTER (WHERE b."isTransfer" AND ${statusCond})::int AS "transferCount",
         COUNT(*) FILTER (WHERE ${statusCond} AND ${typeCond})::int AS "total"
       FROM base b`,
      params,
    );
    const c = countRows?.[0] ?? {};
    const total = Number(c.total) || 0;
    const meta = {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      allCount: Number(c.allCount) || 0,
      pendingCount: Number(c.pendingCount) || 0,
      completedCount: Number(c.completedCount) || 0,
      typeAllCount: Number(c.typeAllCount) || 0,
      customerCount: Number(c.customerCount) || 0,
      transferCount: Number(c.transferCount) || 0,
    };

    const pageRows: any[] = await this.dataSource.query(
      `${baseCte}
       SELECT ts."tripCode",
              ts."status",
              ts."stopType",
              ts."hubId",
              ts."processedAt",
              ts."createdAt",
              b."isTransfer",
              h."name" AS "hubName",
              (SELECT oh."name" FROM "trip_stop" os JOIN "hub" oh ON oh.id = os."hubId"
               WHERE os."tripCode" = ts."tripCode" AND os."stopType" = 'ORIGIN' AND os."deletedAt" IS NULL
               LIMIT 1) AS "originHubName",
              agg."firstTripId", agg."licensePlate", agg."driverName", agg."pickupDate",
              agg."ordersCount", agg."ordersForHubCount", agg."totalWeight", agg."totalVolume", agg."totalQuantity"
       FROM base b
       JOIN "trip_stop" ts ON ts."tripCode" = b."tripCode" AND ts."hubId" = b."hubId" AND ts."deletedAt" IS NULL
       JOIN "hub" h ON h.id = ts."hubId"
       LEFT JOIN LATERAL (
         SELECT MIN(t.id) AS "firstTripId",
                MAX(t."licensePlate") AS "licensePlate",
                MAX(t."driverName") AS "driverName",
                MAX(t."pickupDate") AS "pickupDate",
                COUNT(DISTINCT t."orderId")::int AS "ordersCount",
                COUNT(DISTINCT t."orderId") FILTER (
                  WHERE o."destinationHubId" = ts."hubId" OR o."destinationHubId" IS NULL
                     OR NOT EXISTS (SELECT 1 FROM "trip_stop" ds WHERE ds."tripCode" = ts."tripCode" AND ds."hubId" = o."destinationHubId" AND ds."deletedAt" IS NULL)
                )::int AS "ordersForHubCount",
                COALESCE(SUM(t."weightAllocated"), 0) AS "totalWeight",
                COALESCE(SUM(t."volumeAllocated"), 0) AS "totalVolume",
                COALESCE(SUM(COALESCE(t."quantityAllocated", o."totalQuantity", 1)), 0) AS "totalQuantity"
         FROM "trip" t
         JOIN "order" o ON o.id = t."orderId" AND o."deletedAt" IS NULL
         WHERE t."tripCode" = ts."tripCode" AND t."deletedAt" IS NULL
       ) agg ON true
       WHERE ${statusCond} AND ${typeCond}
       ORDER BY CASE WHEN b."status" = 'PENDING' THEN 0 ELSE 1 END, ts."createdAt" DESC
       LIMIT ${limit} OFFSET ${skip}`,
      params,
    );

    if (pageRows.length === 0) {
      return { data: [], meta };
    }

    const tripCodes = pageRows.map((r) => r.tripCode);
    const ordersByTripCode = new Map<string, any[]>();

    if (tripCodes.length > 0) {
      const trips = await this.tripRepository
        .createQueryBuilder('t')
        .where('t.deletedAt IS NULL')
        .andWhere('t.tripCode IN (:...tripCodes)', { tripCodes })
        .orderBy('t.id', 'ASC')
        .getMany();

      const orderIds = Array.from(new Set(trips.map((t) => t.orderId)));
      const orders =
        orderIds.length > 0
          ? await this.orderRepository
              .createQueryBuilder('order')
              .leftJoinAndSelect('order.originHubEntity', 'originHubEntity')
              .leftJoinAndSelect(
                'order.destinationHubEntity',
                'destinationHubEntity',
              )
              .leftJoinAndSelect('order.currentHubEntity', 'currentHubEntity')
              .where('order.deletedAt IS NULL')
              .andWhere('order.id IN (:...orderIds)', { orderIds })
              .getMany()
          : [];

      const tripsByOrderId = new Map<number, TripEntity[]>();
      for (const t of trips) {
        const list = tripsByOrderId.get(t.orderId) || [];
        list.push(t);
        tripsByOrderId.set(t.orderId, list);
      }

      for (const order of orders) {
        order.trips = tripsByOrderId.get(order.id) || [];
      }

      for (const order of orders) {
        let deliveryAddress = '';
        if (order.route && order.route.includes('→')) {
          const parts = order.route.split('→');
          deliveryAddress = parts[1]?.trim() || '';
        }
        if (!deliveryAddress && order.notes) {
          const match = order.notes.match(/\[Giao khách:\s*([^\]]+)\]/);
          if (match) deliveryAddress = match[1].trim();
        }
        if (!deliveryAddress) {
          deliveryAddress =
            order.destinationHub ||
            order.destinationHubEntity?.name ||
            order.province ||
            '';
        }

        let pickupAddress = order.originHub || '';
        if (
          (!pickupAddress || pickupAddress === 'Hub') &&
          order.route &&
          order.route.includes('→')
        ) {
          pickupAddress = order.route.split('→')[0]?.trim() || '';
        }
        const destEnt = order.destinationHubEntity;
        const isXeBoDest =
          destEnt?.level === 2 ||
          destEnt?.code?.startsWith('XB-') ||
          destEnt?.code?.startsWith('HUB-BO-') ||
          destEnt?.name?.toLowerCase().includes('xe bo');
        const deliveryMode = order.destinationHubId
          ? isXeBoDest
            ? 'XE_BO'
            : 'HUB_L1'
          : 'DIRECT_CUSTOMER';

        const enrichedOrder = {
          ...order,
          pickupAddress,
          deliveryAddress: deliveryAddress || '—',
          deliveryMode,
        };

        for (const trip of order.trips || []) {
          if (trip.tripCode && tripCodes.includes(trip.tripCode)) {
            const list = ordersByTripCode.get(trip.tripCode) || [];
            if (!list.some((o) => o.id === order.id)) {
              const tripEnrichedOrder = {
                ...enrichedOrder,
                tripId: trip.id,
                quantityAllocated:
                  trip.quantityAllocated != null &&
                  Number(trip.quantityAllocated) > 0
                    ? Number(trip.quantityAllocated)
                    : Number(order.totalQuantity) || 1,
                weightAllocated:
                  trip.weightAllocated != null &&
                  Number(trip.weightAllocated) >= 0
                    ? Number(trip.weightAllocated)
                    : Number(order.totalWeight) || 0,
                volumeAllocated:
                  trip.volumeAllocated != null &&
                  Number(trip.volumeAllocated) >= 0
                    ? Number(trip.volumeAllocated)
                    : Number(order.totalVolume) || 0,
                tripNotes: trip.notes,
              };
              list.push(tripEnrichedOrder);
              ordersByTripCode.set(trip.tripCode, list);
            }
          }
        }
      }
    }

    const formatted = pageRows.map((r) => {
      const tripOrders = ordersByTripCode.get(r.tripCode) || [];
      const descs = Array.from(
        new Set(tripOrders.map((x) => x.goodsDescription).filter(Boolean)),
      );
      const goodsDesc =
        descs.length === 1
          ? descs[0]
          : descs.length > 1
            ? `${descs[0]} (+${descs.length - 1} loại hàng)`
            : 'Hàng hóa tổng quan';

      const receiveDateStr =
        r.pickupDate ||
        (r.createdAt
          ? new Date(r.createdAt).toISOString().split('T')[0]
          : undefined);

      return {
        id: r.firstTripId != null ? Number(r.firstTripId) : null,
        groupKey: r.tripCode,
        tripCode: r.tripCode,
        vehicleLicensePlate: r.licensePlate || 'CHƯA GÁN XE',
        licensePlate: r.licensePlate || 'CHƯA GÁN XE',
        driverName: r.driverName || '',
        pickupDate: r.pickupDate || null,
        receiveDate: receiveDateStr,
        status: r.status,
        hubStatus: r.status,
        stopType: r.stopType,
        hubId: Number(r.hubId),
        originHub: r.originHubName || '',
        destinationHub: r.hubName || '',
        isTransfer: !!r.isTransfer,
        ordersCount: Number(r.ordersCount) || tripOrders.length,
        remainingOrdersCount: Number(r.ordersForHubCount) || 0,
        totalQuantity: Number(r.totalQuantity) || 0,
        totalWeight: Math.round(Number(r.totalWeight) * 100) / 100,
        totalVolume: Math.round(Number(r.totalVolume) * 1000) / 1000,
        goodsDescription: goodsDesc,
        processedAt: r.processedAt,
        orders: tripOrders,
      };
    });

    return {
      data: formatted,
      meta,
    };
  }

  /**
   * Trích xuất địa chỉ giao hàng chuẩn hóa từ hợp đồng đơn hàng
   */
  private extractDeliveryAddress(order: {
    route?: string | null;
    notes?: string | null;
    destinationHub?: string | null;
    destinationHubEntity?: { name?: string | null } | null;
    province?: string | null;
  }): string {
    if (!order) return '—';
    if (order.route && order.route.includes('→')) {
      const parts = order.route.split('→');
      const dest = parts[1]?.trim();
      if (
        dest &&
        dest !== 'Điểm đến' &&
        dest !== 'Điểm giao' &&
        dest !== 'Hub'
      ) {
        return dest;
      }
    }
    if (order.notes) {
      const match = order.notes.match(/\[Giao khách:\s*([^\]]+)\]/);
      if (match && match[1]?.trim()) return match[1].trim();
    }
    if (order.destinationHub && order.destinationHub.trim()) {
      return order.destinationHub.trim();
    }
    if (
      order.destinationHubEntity?.name &&
      order.destinationHubEntity.name.trim()
    ) {
      return order.destinationHubEntity.name.trim();
    }
    if (order.province && order.province.trim()) {
      return order.province.trim();
    }
    return '—';
  }

  /**
   * Lấy dữ liệu in ấn Phiếu Nhập Kho A4 (hỗ trợ tripCode, invoiceCode hoặc orderCode)
   */
  async getInboundReceiptData(
    user: UserEntity,
    query: { tripCode?: string; orderCode?: string; invoiceCode?: string },
  ): Promise<{
    tripCode?: string;
    orderCode: string;
    licensePlate: string;
    driverName: string;
    originHubName?: string;
    destinationHubName: string;
    deliveryAddress: string;
    totalQuantity: number;
    totalWeight: number;
    totalVolume: number;
    createdAt?: Date | string;
    items: Array<{
      orderCode: string;
      goodsDescription: string;
      quantity: number;
      unit: string;
      deliveryAddress: string;
      accompanyingDocs: string;
      notes: string;
      weight?: number;
      volume?: number;
    }>;
  }> {
    const rawTripCode = query?.tripCode
      ? normalizeTripCode(query.tripCode)
      : '';
    const rawOrderCode = query?.orderCode?.trim() || '';
    const rawInvoiceCode = query?.invoiceCode?.trim() || '';

    if (!rawTripCode && !rawOrderCode && !rawInvoiceCode) {
      throw new UnprocessableEntityException(
        'Vui lòng cung cấp tripCode, orderCode hoặc invoiceCode',
      );
    }

    let tripCode = rawTripCode;
    let licensePlate = '';
    let driverName = '';
    let originHubName = '';
    let destinationHubName = '';
    let deliveryAddress = '';
    let createdAt: Date | string | undefined;

    let orders: OrderEntity[] = [];

    if (tripCode) {
      const resolvedUserHubId = await this.resolveUserHubId(user);
      const stops: any[] = await this.dataSource.query(
        `SELECT ts."hubId", ts."status" FROM "trip_stop" ts WHERE ts."tripCode" = $1 AND ts."deletedAt" IS NULL`,
        [tripCode],
      );
      const userStop = resolvedUserHubId
        ? stops.find((s) => Number(s.hubId) === resolvedUserHubId)
        : null;
      const hasCompletedStop = userStop
        ? userStop.status === TripStopStatus.COMPLETED
        : stops.some((s) => s.status === TripStopStatus.COMPLETED);

      const inboundTx = await this.transactionRepository.findOne({
        where: {
          tripCode,
          type: InventoryTransactionType.INBOUND,
          deletedAt: IsNull(),
          ...(resolvedUserHubId ? { hubId: resolvedUserHubId } : {}),
        },
      });

      if (!hasCompletedStop && !inboundTx) {
        throw new BadRequestException(
          'Chuyến xe đang ở trạng thái Chờ xử lý, chưa hoàn tất kiểm đếm dỡ hàng để in phiếu nhập kho',
        );
      }

      const trips = await this.tripRepository.find({
        where: { tripCode, deletedAt: IsNull() },
        relations: [
          'order',
          'order.originHubEntity',
          'order.destinationHubEntity',
        ],
      });

      if (trips.length > 0) {
        licensePlate = trips[0].licensePlate || '';
        driverName = trips[0].driverName || '';
        createdAt = trips[0].createdAt || trips[0].pickupDate;
        const orderIds = Array.from(
          new Set(trips.map((t) => t.orderId).filter(Boolean)),
        );
        if (orderIds.length > 0) {
          orders = await this.orderRepository.find({
            where: { id: In(orderIds), deletedAt: IsNull() },
            relations: ['originHubEntity', 'destinationHubEntity'],
          });
        }
      }
    }

    if (orders.length === 0 && rawInvoiceCode) {
      const txs = await this.transactionRepository.find({
        where: { invoiceCode: rawInvoiceCode, deletedAt: IsNull() },
        relations: [
          'order',
          'order.originHubEntity',
          'order.destinationHubEntity',
          'hub',
        ],
      });
      if (txs.length > 0) {
        tripCode = tripCode || txs[0].tripCode || '';
        licensePlate = licensePlate || txs[0].licensePlate || '';
        driverName = driverName || txs[0].driverName || '';
        originHubName = originHubName || txs[0].hub?.name || '';
        createdAt = createdAt || txs[0].createdAt;
        orders = txs.map((t) => t.order).filter(Boolean);
      }
    }

    if (orders.length === 0 && rawOrderCode) {
      const singleOrder = await this.orderRepository.findOne({
        where: { orderCode: rawOrderCode, deletedAt: IsNull() },
        relations: ['originHubEntity', 'destinationHubEntity', 'trips'],
      });
      if (singleOrder) {
        orders = [singleOrder];
        if (singleOrder.trips && singleOrder.trips.length > 0) {
          const t = singleOrder.trips[0];
          tripCode = tripCode || t.tripCode || '';
          licensePlate = licensePlate || t.licensePlate || '';
          driverName = driverName || t.driverName || '';
          createdAt = createdAt || t.createdAt;
        }
      }
    }

    if (orders.length === 0) {
      throw new NotFoundException('Không tìm thấy dữ liệu phiếu nhập kho');
    }

    const items = orders.map((o) => {
      const deliv = this.extractDeliveryAddress(o);
      return {
        orderCode: o.orderCode,
        goodsDescription: o.goodsDescription || 'Hàng hóa nhập kho',
        quantity: Number(o.inboundQuantity || o.totalQuantity || 1),
        unit: 'Kiện',
        deliveryAddress: deliv,
        accompanyingDocs: o.accompanyingDocs || 'KHÔNG CÓ',
        notes: o.notes || '',
        weight: Number(o.totalWeight) || 0,
        volume: Number(o.totalVolume) || 0,
      };
    });

    const first = orders[0];
    originHubName =
      originHubName || first.originHub || first.originHubEntity?.name || '';
    destinationHubName =
      destinationHubName ||
      first.destinationHub ||
      first.destinationHubEntity?.name ||
      '';
    deliveryAddress = deliveryAddress || items[0]?.deliveryAddress || '—';

    const totalQuantity = items.reduce((sum, it) => sum + it.quantity, 0);
    const totalWeight = orders.reduce(
      (sum, o) => sum + (Number(o.totalWeight) || 0),
      0,
    );
    const totalVolume = orders.reduce(
      (sum, o) => sum + (Number(o.totalVolume) || 0),
      0,
    );

    return {
      tripCode: tripCode || undefined,
      orderCode: first.orderCode,
      licensePlate: licensePlate || '—',
      driverName: driverName || '—',
      originHubName,
      destinationHubName,
      deliveryAddress,
      totalQuantity,
      totalWeight,
      totalVolume,
      createdAt: createdAt || new Date(),
      items,
    };
  }

  /**
   * Full manifest of a logical trip (all order lines on the vehicle) as seen by the viewer hub:
   * which lines are to be unloaded here, expected / already received quantities, per-hub stop status.
   * Read-only — never alters data (skipping a line keeps it on the truck for the next hub).
   */
  async getTripManifest(
    user: UserEntity,
    tripCodeParam: string,
    hubIdParam?: number,
  ): Promise<any> {
    const code = normalizeTripCode(decodeURIComponent(tripCodeParam || ''));
    if (!code) {
      throw new NotFoundException('Không tìm thấy chuyến xe');
    }
    const resolvedUserHubId = await this.resolveUserHubId(user);

    const baseQb = () =>
      this.tripRepository
        .createQueryBuilder('trip')
        .innerJoinAndSelect('trip.order', 'order')
        .leftJoinAndSelect('order.originHubEntity', 'originHubEntity')
        .leftJoinAndSelect('order.destinationHubEntity', 'destinationHubEntity')
        .leftJoinAndSelect('trip.destinationHub', 'tripDestinationHub')
        .where('trip.deletedAt IS NULL')
        .andWhere('order.deletedAt IS NULL');

    let trips = await baseQb()
      .andWhere('trip.tripCode = :code', { code })
      .orderBy('trip.id', 'ASC')
      .getMany();

    // Legacy groups without a persisted code are displayed as TRIP-{id}
    const legacy = /^TRIP-(\d+)$/i.exec(code);
    if (trips.length === 0 && legacy) {
      trips = await baseQb()
        .andWhere('trip.id = :id', { id: Number(legacy[1]) })
        .getMany();
    }
    if (trips.length === 0) {
      throw new NotFoundException(`Không tìm thấy chuyến xe ${code}`);
    }

    const stops: any[] = await this.dataSource.query(
      `SELECT ts."hubId", h."name" AS "hubName", ts."stopSequence", ts."stopType", ts."status", ts."processedAt"
       FROM "trip_stop" ts JOIN "hub" h ON h.id = ts."hubId"
       WHERE ts."tripCode" = $1 AND ts."deletedAt" IS NULL
       ORDER BY ts."stopSequence" ASC, ts.id ASC`,
      [code],
    );

    const completedStop = stops.find(
      (s) => s.status === TripStopStatus.COMPLETED,
    );
    const viewerHubId =
      resolvedUserHubId ??
      (hubIdParam ? Number(hubIdParam) : null) ??
      (completedStop ? Number(completedStop.hubId) : null) ??
      (stops[0] ? Number(stops[0].hubId) : 2);

    const sums: any[] = await this.dataSource.query(
      `SELECT "orderId", "type", "hubId", COALESCE(SUM("quantity"), 0)::int AS "qty"
       FROM "order_inventory_transaction"
       WHERE "tripCode" = $1 AND "deletedAt" IS NULL
       GROUP BY "orderId", "type", "hubId"`,
      [code],
    );

    const orderIds = Array.from(new Set(trips.map((t) => t.orderId)));
    const hubView = viewerHubId
      ? await this.computeHubView(orderIds, viewerHubId)
      : new Map<number, { hubStatus: string; hubStock: number }>();

    const seen = new Set<number>();
    const lines = trips
      .filter((t) => {
        if (!t.order) return false;
        if (seen.has(t.orderId)) return false;
        seen.add(t.orderId);
        return true;
      })
      .map((t) => {
        const o = t.order;
        const mine = sums.filter((s) => Number(s.orderId) === o.id);
        const loaded = mine
          .filter(
            (s) =>
              s.type === InventoryTransactionType.TRANSFER ||
              s.type === InventoryTransactionType.OUTBOUND,
          )
          .reduce((a, s) => a + Number(s.qty), 0);
        const receivedAll = mine
          .filter((s) => s.type === InventoryTransactionType.INBOUND)
          .reduce((a, s) => a + Number(s.qty), 0);
        const receivedHere = viewerHubId
          ? mine
              .filter(
                (s) =>
                  s.type === InventoryTransactionType.INBOUND &&
                  Number(s.hubId) === viewerHubId,
              )
              .reduce((a, s) => a + Number(s.qty), 0)
          : 0;
        const expectedQuantity =
          loaded > 0
            ? loaded
            : Number(t.quantityAllocated) > 0
              ? Number(t.quantityAllocated)
              : Number(o.totalQuantity) || 0;
        const inTransitQuantity =
          loaded > 0 ? Math.max(0, loaded - receivedAll) : 0;

        let pickupAddress = o.originHub || '';
        let deliveryAddress = '';
        if (o.route && o.route.includes('→')) {
          const parts = o.route.split('→');
          if (!pickupAddress || pickupAddress === 'Hub')
            pickupAddress = parts[0]?.trim() || '';
          deliveryAddress = parts[1]?.trim() || '';
        }

        const resolvedOriginHub = o.originHub || o.originHubEntity?.name || '';
        let resolvedDestHub =
          o.destinationHub || o.destinationHubEntity?.name || '';

        let originalDeliveryAddress = '';
        if (o.route && o.route.includes('→')) {
          const parts = o.route.split('→');
          originalDeliveryAddress = parts[1]?.trim() || '';
        } else {
          originalDeliveryAddress =
            deliveryAddress || resolvedDestHub || o.province || '';
        }

        const rawDestHubId =
          t.destinationHubId !== undefined && t.destinationHubId !== null
            ? t.destinationHubId
            : o.destinationHubId !== undefined && o.destinationHubId !== null
              ? o.destinationHubId
              : null;

        let deliveryMode: 'DIRECT_CUSTOMER' | 'HUB_L1' | 'XE_BO' =
          'DIRECT_CUSTOMER';
        const destEntity = (t as any).destinationHub || o.destinationHubEntity;

        if (
          t.type === 'OUTBOUND' ||
          t.notes?.includes('[XUẤT KHO - GIAO KHÁCH]') ||
          t.notes?.includes('[NHÁP XUẤT KHO - GIAO KHÁCH]') ||
          (!rawDestHubId && !destEntity)
        ) {
          deliveryMode = 'DIRECT_CUSTOMER';
        } else if (
          destEntity?.level === 2 ||
          destEntity?.code?.startsWith('HUB-BO-') ||
          destEntity?.code?.startsWith('XB-') ||
          destEntity?.name?.toLowerCase().includes('xe bo') ||
          (o.destinationHub &&
            (o.destinationHub.toLowerCase().includes('xe bo') ||
              o.destinationHub.toLowerCase().includes('hub-bo')))
        ) {
          deliveryMode = 'XE_BO';
        } else if (
          destEntity?.level === 1 ||
          (rawDestHubId && rawDestHubId > 0)
        ) {
          deliveryMode = 'HUB_L1';
        } else {
          deliveryMode = 'DIRECT_CUSTOMER';
        }

        const effectiveDestHubId =
          deliveryMode === 'DIRECT_CUSTOMER' ? null : rawDestHubId;

        // isForCurrentHub: Zero-Assumption principle
        // DIRECT_CUSTOMER: hàng trên xe giao thẳng khách, KHÔNG dỡ vào kho trung chuyển viewerHubId
        let isForCurrentHub = false;
        if (viewerHubId) {
          if (deliveryMode === 'DIRECT_CUSTOMER') {
            isForCurrentHub = false;
          } else if (effectiveDestHubId) {
            isForCurrentHub = effectiveDestHubId === viewerHubId;
          } else if (o.destinationHub) {
            const destLower = o.destinationHub.trim().toLowerCase();
            // Support logistics abbreviations: ĐN = Đà Nẵng, HY = Hưng Yên, HCM = TP. Hồ Chí Minh
            const isDestDaNang =
              destLower === 'đn' ||
              destLower === 'dn' ||
              destLower.includes('đà nẵng') ||
              destLower.includes('da nang');
            const isDestHungYen =
              destLower === 'hy' ||
              destLower.includes('hưng yên') ||
              destLower.includes('hung yen');
            const isDestHcm =
              destLower === 'hcm' ||
              destLower === 'sgn' ||
              destLower.includes('hồ chí minh') ||
              destLower.includes('sài gòn');

            // Standard hub IDs: 1 = HCM, 2 = Đà Nẵng, 3 = Hưng Yên
            if (isDestDaNang && viewerHubId === 2) {
              isForCurrentHub = true;
            } else if (isDestHungYen && viewerHubId === 3) {
              isForCurrentHub = true;
            } else if (isDestHcm && viewerHubId === 1) {
              isForCurrentHub = true;
            }
          }
        }

        const matchedHub =
          destEntity && destEntity.id === effectiveDestHubId
            ? destEntity
            : (t as any).destinationHub &&
                (t as any).destinationHub.id === effectiveDestHubId
              ? (t as any).destinationHub
              : destEntity;

        let resolvedDestEntity: any = null;
        if (matchedHub) {
          resolvedDestEntity = {
            id: matchedHub.id,
            name: matchedHub.name,
            code: matchedHub.code,
            level: matchedHub.level ?? (deliveryMode === 'XE_BO' ? 2 : 1),
            city: matchedHub.city,
            address: matchedHub.address ?? null,
          };
        } else if (effectiveDestHubId) {
          resolvedDestEntity = {
            id: effectiveDestHubId,
            name: resolvedDestHub || `Hub ${effectiveDestHubId}`,
            code: null,
            level: deliveryMode === 'XE_BO' ? 2 : 1,
            city: null,
            address: null,
          };
        }

        if (deliveryMode === 'DIRECT_CUSTOMER') {
          deliveryAddress =
            deliveryAddress || originalDeliveryAddress || resolvedDestHub || '';
          resolvedDestHub = deliveryAddress || 'Giao thẳng khách';
        } else if (resolvedDestEntity?.name) {
          resolvedDestHub =
            resolvedDestEntity.address &&
            !resolvedDestEntity.name.includes(resolvedDestEntity.address)
              ? `${resolvedDestEntity.name} — ${resolvedDestEntity.address}`
              : resolvedDestEntity.name;
        }

        const view = hubView.get(o.id);
        return {
          ...o,
          originHub: resolvedOriginHub,
          destinationHub: resolvedDestHub,
          destinationHubId: effectiveDestHubId,
          destinationHubEntity: resolvedDestEntity,
          pickupAddress: pickupAddress || resolvedOriginHub || '',
          deliveryAddress: deliveryAddress || resolvedDestHub || '',
          originalDeliveryAddress:
            originalDeliveryAddress || deliveryAddress || resolvedDestHub || '',
          deliveryMode,
          tripId: t.id,
          weightAllocated: Number(t.weightAllocated) || 0,
          volumeAllocated: Number(t.volumeAllocated) || 0,
          expectedQuantity,
          inTransitQuantity,
          receivedQuantity: receivedHere,
          isForCurrentHub,
          isReceivedHere: receivedHere > 0,
          isContractLocked: !DRAFT_LIKE_STATUSES.includes(o.status),
          hubStatus: view?.hubStatus ?? o.status,
          hubStock: view ? view.hubStock : null,
        };
      });

    const first = trips[0];
    const currentStop = viewerHubId
      ? stops.find((s) => Number(s.hubId) === viewerHubId)
      : undefined;

    const userWithHub = await this.userRepository.findOne({
      where: { id: user.id },
      relations: ['hub', 'role'],
    });
    const roleId = Number(
      userWithHub?.role?.id ?? user.role?.id ?? (user.role as any),
    );
    const roleName =
      userWithHub?.role?.name ||
      (typeof user.role === 'string' ? user.role : (user.role as any)?.name) ||
      'WAREHOUSE_MANAGER';
    const isAdmin =
      roleId === RoleEnum.SUPER_ADMIN ||
      roleName === 'SUPER_ADMIN' ||
      (user.role as any) === 'SUPER_ADMIN';

    const isCurrentHubCompleted =
      currentStop?.status === TripStopStatus.COMPLETED;
    const canModifyOrders = !isCurrentHubCompleted || isAdmin;
    const canAddOrders = !isCurrentHubCompleted || isAdmin;
    const isReadOnlyForHub = isCurrentHubCompleted && !isAdmin;

    return {
      tripCode: first.tripCode || code,
      licensePlate: first.licensePlate || '',
      driverName: first.driverName || '',
      pickupDate: first.pickupDate || null,
      isTransfer:
        stops.length > 1 ||
        sums.some((s) => s.type === InventoryTransactionType.TRANSFER) ||
        trips.some((t) => t.type === 'TRANSFER'),
      stops: stops.map((s) => ({
        hubId: Number(s.hubId),
        hubName: s.hubName,
        stopSequence: Number(s.stopSequence),
        stopType: s.stopType,
        status: s.status,
        processedAt: s.processedAt,
      })),
      currentHubId: viewerHubId,
      /** PENDING = Chờ xử lý, COMPLETED = Đã xử lý, null = chuyến không dừng tại kho này */
      currentHubStatus: currentStop?.status ?? null,
      isCurrentHubCompleted,
      canModifyOrders,
      canAddOrders,
      isReadOnlyForHub,
      userRole: roleName,
      lines,
    };
  }

  /**
   * Lấy danh sách các đơn hàng đang lưu tại kho hiện tại sẵn sàng để xuất lên chuyến xe
   */
  async getAvailableOutboundOrders(
    user: UserEntity,
    tripCodeParam: string,
    queryHubId?: number,
  ): Promise<{
    tripCode: string;
    currentHubId: number | null;
    currentHubName: string;
    downstreamHubs: Array<{ id: number; name: string }>;
    orders: OrderEntity[];
  }> {
    const tripCode = normalizeTripCode(decodeURIComponent(tripCodeParam || ''));
    const userWithHub = await this.loadUserWithHub(user);

    // Ưu tiên 1: queryHubId từ frontend
    // Ưu tiên 2: userWithHub.hubId của user
    // Fallback: hubId = 2 (Magellan Hub - Đà Nẵng)
    let currentHubId =
      queryHubId && !isNaN(Number(queryHubId))
        ? Number(queryHubId)
        : userWithHub.hubId;
    let currentHubName = userWithHub.hub?.name || 'Kho hiện tại';

    if (currentHubId && currentHubId !== userWithHub.hubId) {
      const hubRepo = this.dataSource.getRepository(HubEntity);
      const queriedHub = await hubRepo.findOne({ where: { id: currentHubId } });
      if (queriedHub) {
        currentHubName = queriedHub.name;
      }
    }

    if (!currentHubId) {
      currentHubId = 2;
      currentHubName = 'Magellan Hub - Đà Nẵng';
    }

    // Lấy danh sách các điểm dừng của chuyến xe
    const stops: any[] = await this.dataSource.query(
      `SELECT ts."hubId", h."name" AS "hubName", ts."stopSequence", ts."status"
       FROM "trip_stop" ts
       JOIN "hub" h ON h.id = ts."hubId"
       WHERE ts."tripCode" = $1 AND ts."deletedAt" IS NULL
       ORDER BY ts."stopSequence" ASC, ts.id ASC`,
      [tripCode],
    );

    // Chuẩn hóa xác định trạm kế tiếp (downstreamHubs):
    // Lấy mọi trạm khác trạm hiện tại và chưa hoàn tất (status != 'COMPLETED')
    let downstreamStops = stops.filter(
      (s) => Number(s.hubId) !== currentHubId && s.status !== 'COMPLETED',
    );

    // Nếu không có trạm nào chưa hoàn tất, lấy tất cả các trạm khác trạm hiện tại trong stops
    if (downstreamStops.length === 0) {
      downstreamStops = stops.filter((s) => Number(s.hubId) !== currentHubId);
    }

    // Nếu chuyến xe chưa có trạm dừng nào ngoài trạm hiện tại, lấy các Hub cấp 1/2 trên tuyến vận tải để thủ kho chọn linh hoạt
    if (downstreamStops.length === 0) {
      const hubRepo = this.dataSource.getRepository(HubEntity);
      const otherHubs = await hubRepo.find({
        where: { deletedAt: IsNull() },
        order: { id: 'ASC' },
        take: 10,
      });
      downstreamStops = otherHubs
        .filter((h) => h.id !== currentHubId)
        .map((h, idx) => ({
          hubId: h.id,
          hubName: h.name,
          stopSequence: idx + 1,
          status: 'PENDING',
        }));
    }

    // Lấy các đơn hàng đang lưu kho tại kho hiện tại:
    // Hỗ trợ cả currentHubId = :currentHubId, originHubId = :currentHubId, hoặc có tồn kho theo sổ cái
    // Hỗ trợ status IN ('IN_WAREHOUSE', 'INBOUND', 'STORED', 'LUU_KHO') hoặc DRAFT/WAITING/PENDING tại originHub
    const orderRepo = this.dataSource.getRepository(OrderEntity);
    const orders = await orderRepo
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.originHubEntity', 'originHubEntity')
      .leftJoinAndSelect('order.destinationHubEntity', 'destinationHubEntity')
      .where('order.deletedAt IS NULL')
      .andWhere(
        new Brackets((qb) => {
          qb.where('order.currentHubId = :currentHubId', { currentHubId })
            .orWhere(
              '(order.currentHubId IS NULL AND order.originHubId = :currentHubId)',
              { currentHubId },
            )
            .orWhere(
              `EXISTS (
                SELECT 1 FROM order_inventory_transaction tx 
                WHERE tx."orderId" = order.id 
                  AND tx."hubId" = :currentHubId 
                  AND tx."deletedAt" IS NULL
              )`,
              { currentHubId },
            );
        }),
      )
      .andWhere(
        new Brackets((qb) => {
          qb.where(
            "order.status IN ('IN_WAREHOUSE', 'INBOUND', 'STORED', 'LUU_KHO')",
          ).orWhere(
            "(order.status IN ('DRAFT', 'WAITING', 'PENDING') AND (order.originHubId = :currentHubId OR order.currentHubId = :currentHubId OR order.currentHubId IS NULL))",
            { currentHubId },
          );
        }),
      )
      .andWhere('COALESCE(order.remainingQuantity, order.totalQuantity) > 0')
      .andWhere(
        '(order.currentTripCode IS NULL OR order.currentTripCode != :tripCode)',
        { tripCode },
      )
      .orderBy('order.id', 'DESC')
      .getMany();

    const orderIds = orders.map((o) => o.id);
    const pendingAllocMap =
      await this.ledgerService.getBatchPendingOutboundAllocations(
        orderIds,
        currentHubId,
        tripCode || undefined,
      );

    const availableOrders = orders
      .map((order) => {
        const pending = pendingAllocMap.get(order.id);
        const pendingOutboundQuantity = pending?.pendingQty ?? 0;
        const pendingOutboundTripCodes = pending?.tripCodes ?? [];
        const baseStock = Number(
          order.remainingQuantity ?? order.totalQuantity ?? 0,
        );
        const effectiveHubStock = Math.max(
          0,
          baseStock - pendingOutboundQuantity,
        );
        (order as any).pendingOutboundQuantity = pendingOutboundQuantity;
        (order as any).pendingOutboundTripCodes = pendingOutboundTripCodes;
        (order as any).effectiveHubStock = effectiveHubStock;
        return order;
      })
      .filter((order) => (order as any).effectiveHubStock > 0);

    return {
      tripCode,
      currentHubId,
      currentHubName,
      downstreamHubs: downstreamStops.map((s) => ({
        id: Number(s.hubId),
        name: s.hubName,
      })),
      orders: availableOrders,
    };
  }

  /**
   * Bốc hàng loạt đơn hàng lưu kho sẵn có lên chuyến xe xuất kho
   */
  async appendStoredOrdersToTrip(
    user: UserEntity,
    tripCodeParam: string,
    dto: AppendStoredOrdersDto,
  ): Promise<{
    success: boolean;
    tripCode: string;
    appendedCount: number;
    orders: any[];
  }> {
    const tripCode = normalizeTripCode(decodeURIComponent(tripCodeParam || ''));
    if (!tripCode) {
      throw new BadRequestException('Mã chuyến xe không hợp lệ');
    }

    if (!dto.orderIds || dto.orderIds.length === 0) {
      throw new BadRequestException('Vui lòng chọn ít nhất 1 đơn hàng lưu kho');
    }

    const userWithHub = await this.loadUserWithHub(user);
    let currentHubId = dto.hubId || userWithHub.hubId;
    let currentHubName = userWithHub.hub?.name || 'Kho hiện tại';

    if (currentHubId && currentHubId !== userWithHub.hubId) {
      const hubRepo = this.dataSource.getRepository(HubEntity);
      const queriedHub = await hubRepo.findOne({ where: { id: currentHubId } });
      if (queriedHub) {
        currentHubName = queriedHub.name;
      }
    }

    if (!currentHubId) {
      currentHubId = 2;
      currentHubName = 'Magellan Hub - Đà Nẵng';
    }

    await this.validateTripStopEditPermission(
      user,
      tripCode,
      currentHubId,
      'bốc đơn lưu kho lên xe',
    );

    // 1. Tìm thông tin chuyến xe đang có
    const tripRepo = this.dataSource.getRepository(TripEntity);
    const existingTrips = await tripRepo.find({
      where: { tripCode, deletedAt: IsNull() },
      order: { id: 'ASC' },
    });

    if (existingTrips.length === 0) {
      throw new NotFoundException(`Không tìm thấy chuyến xe ${tripCode}`);
    }

    const firstTrip = existingTrips[0];
    const licensePlate = firstTrip.licensePlate || '';
    const driverName = firstTrip.driverName || '';

    // 2. Tìm điểm dừng tiếp theo nếu có destinationHubId được chỉ định
    let destHubName = '';
    if (dto.destinationHubId) {
      const hubRepo = this.dataSource.getRepository(HubEntity);
      const targetHub = await hubRepo.findOne({
        where: { id: dto.destinationHubId },
      });
      if (targetHub) {
        destHubName = targetHub.name;
      }
    }

    // 3. Thực hiện trong transaction
    return await this.dataSource.transaction(async (manager) => {
      const txOrderRepo = manager.getRepository(OrderEntity);
      const txTripRepo = manager.getRepository(TripEntity);
      const txInvRepo = manager.getRepository(OrderInventoryTransactionEntity);

      const orders = await txOrderRepo
        .createQueryBuilder('order')
        .leftJoinAndSelect('order.originHubEntity', 'originHubEntity')
        .leftJoinAndSelect('order.destinationHubEntity', 'destinationHubEntity')
        .where('order.id IN (:...orderIds)', { orderIds: dto.orderIds })
        .andWhere('order.deletedAt IS NULL')
        .getMany();

      if (orders.length === 0) {
        throw new BadRequestException(
          'Không tìm thấy đơn hàng nào hợp lệ trong danh sách đã chọn',
        );
      }

      const draftOrders = orders.filter((o) =>
        DRAFT_LIKE_STATUSES.includes(o.status),
      );
      if (draftOrders.length > 0) {
        const draftCodes = draftOrders.map((o) => o.orderCode).join(', ');
        throw new BadRequestException(
          `Không thể bốc đơn hàng nháp (${draftCodes}) lên chuyến xe xuất kho. Chuyến xe có đơn nháp chỉ được phép ở trạng thái "Chờ xử lý". Vui lòng duyệt đơn hàng trước khi bốc hàng.`,
        );
      }

      const updatedOrders: any[] = [];

      for (const order of orders) {
        const qty =
          Number(order.remainingQuantity) > 0
            ? Number(order.remainingQuantity)
            : Number(order.totalQuantity) || 1;

        const pendingAlloc =
          await this.ledgerService.getPendingOutboundAllocation(
            order.id,
            currentHubId,
            tripCode || undefined,
            manager,
          );
        const effectiveAvailable = Math.max(0, qty - pendingAlloc.pendingQty);
        if (effectiveAvailable <= 0) {
          const tripHint =
            pendingAlloc.tripCodes.length > 0
              ? ` (${pendingAlloc.tripCodes.join(', ')})`
              : '';
          throw new UnprocessableEntityException(
            `Đơn hàng ${order.orderCode} đã được xếp hết số kiện vào chuyến xe chờ xuất${tripHint}. Không thể bốc lên chuyến ${tripCode}.`,
          );
        }
        const weight = Number(order.totalWeight) || 0;
        const vol = Number(order.totalVolume) || 0;

        const customDest = dto.orderDestinations?.find(
          (d) => Number(d.orderId) === order.id,
        );
        const orderDestHubId =
          customDest?.destinationHubId !== undefined
            ? customDest.destinationHubId
            : order.destinationHubId || dto.destinationHubId || null;
        let orderDestHubName =
          order.destinationHub ||
          destHubName ||
          order.destinationHubEntity?.name ||
          '';
        if (customDest?.deliveryAddress) {
          orderDestHubName = customDest.deliveryAddress;
        }

        order.status = 'IN_TRANSIT';
        order.currentHubId = null;
        order.currentTripCode = tripCode;
        order.outboundQuantity = (Number(order.outboundQuantity) || 0) + qty;
        order.remainingQuantity = Math.max(
          0,
          (Number(order.totalQuantity) || qty) - Number(order.outboundQuantity),
        );

        if (customDest) {
          if (customDest.destinationHubId) {
            order.destinationHubId = customDest.destinationHubId;
            order.destinationHub = orderDestHubName;
          } else if (customDest.destinationHubId === null) {
            order.destinationHubId = null;
            order.destinationHub = null;
          }
        } else if (dto.destinationHubId && !order.destinationHubId) {
          order.destinationHubId = dto.destinationHubId;
          order.destinationHub = destHubName;
        }

        const savedOrder = await txOrderRepo.save(order);

        const savedTrip = await txTripRepo.save(
          txTripRepo.create({
            orderId: savedOrder.id,
            tripCode,
            originHubId: currentHubId || firstTrip.originHubId,
            destinationHubId: orderDestHubId,
            type: 'TRANSFER',
            licensePlate,
            driverName,
            status: 'IN_TRANSIT',
            pickupDate: new Date().toISOString(),
            weightAllocated: weight,
            volumeAllocated: vol,
            quantityAllocated: qty,
            notes:
              dto.notes ||
              `[XUẤT TỪ KHO] Xe ${licensePlate} nhận ${qty} kiện từ ${currentHubName} đi ${orderDestHubName || 'trạm kế tiếp'}`,
          }),
        );

        const routeDest =
          order.route && order.route.includes('→')
            ? order.route.split('→')[1]?.trim()
            : '';

        await txInvRepo.save(
          txInvRepo.create({
            orderId: savedOrder.id,
            type: InventoryTransactionType.TRANSFER,
            hubId: currentHubId,
            tripId: savedTrip.id,
            tripCode,
            quantity: qty,
            expectedQuantity: qty,
            discrepancyQuantity: 0,
            remainingQuantity: 0,
            weight,
            volume: vol,
            licensePlate,
            driverName,
            notes:
              dto.notes ||
              `Xuất hàng từ ${currentHubName} lên xe ${licensePlate} (${tripCode}) đi ${orderDestHubName || 'trạm kế tiếp'}`,
            destination: orderDestHubName || routeDest || '',
            performedByUserId: user.id,
          }),
        );

        updatedOrders.push(savedOrder);
      }

      return {
        success: true,
        tripCode,
        appendedCount: updatedOrders.length,
        orders: updatedOrders,
      };
    });
  }

  /**
   * Cập nhật tiến trình trạm trung chuyển (Transit Stop Lifecycle)
   * Nhận payload { step: 'INBOUND' | 'OUTBOUND', action: 'CONFIRM' | 'SKIP' }
   */
  async updateTransitStep(
    user: UserEntity,
    tripCodeParam: string,
    _body: { step: 'INBOUND' | 'OUTBOUND'; action: 'CONFIRM' | 'SKIP' },
  ): Promise<{
    success: boolean;
    tripCode: string;
    status: string;
    processedAt: Date;
  }> {
    void _body;
    const tripCode = normalizeTripCode(decodeURIComponent(tripCodeParam || ''));
    const userWithHub = await this.loadUserWithHub(user);
    let currentHubId = userWithHub.hubId;
    if (!currentHubId) {
      currentHubId = 2;
    }

    await this.validateTripStopEditPermission(
      user,
      tripCode,
      currentHubId,
      'cập nhật tiến trình trạm chuyến xe',
    );

    // Strict Pending Guard (Task #51): If any order associated with this trip is in DRAFT/WAITING/PENDING,
    // the transit step cannot transition to COMPLETED.
    const tripRepo = this.dataSource.getRepository(TripEntity);
    const orderRepo = this.dataSource.getRepository(OrderEntity);
    const trips = await tripRepo.find({
      where: { tripCode, deletedAt: IsNull() },
    });
    if (trips.length > 0) {
      const orderIds = trips
        .map((t) => t.orderId)
        .filter((id): id is number => !!id);
      if (orderIds.length > 0) {
        const orders = await orderRepo.find({
          where: { id: In(orderIds), deletedAt: IsNull() },
        });
        const draftOrders = orders.filter((o) =>
          DRAFT_LIKE_STATUSES.includes(o.status),
        );
        if (draftOrders.length > 0) {
          const draftCodes = draftOrders.map((o) => o.orderCode).join(', ');
          throw new BadRequestException(
            `Không thể hoàn tất trạm trung chuyển vì chuyến xe ${tripCode} có chứa ${draftOrders.length} đơn hàng đang ở trạng thái đơn nháp (${draftCodes}). Chuyến xe có đơn nháp chỉ được phép ở trạng thái "Chờ xử lý". Vui lòng duyệt đơn hàng trước khi cập nhật.`,
          );
        }
      }
    }

    const tripStopRepo = this.dataSource.getRepository(TripStopEntity);
    let stop = await tripStopRepo.findOne({
      where: { tripCode, hubId: currentHubId },
    });

    const now = new Date();
    if (!stop) {
      stop = tripStopRepo.create({
        tripCode,
        hubId: currentHubId,
        status: TripStopStatus.COMPLETED,
        stopType: TripStopType.TRANSIT,
        stopSequence: 99,
        processedAt: now,
      });
    } else {
      stop.status = TripStopStatus.COMPLETED;
      stop.processedAt = now;
    }
    await tripStopRepo.save(stop);

    return {
      success: true,
      tripCode,
      status: stop.status,
      processedAt: now,
    };
  }

  /**
   * Cập nhật hình thức giao hàng và đích đến cho đơn bốc lên chuyến xe (Giao khách, Hub Cấp 1, Tuyến Xe Bo)
   */
  async updateTripOrderDestination(
    user: UserEntity,
    tripCodeParam: string,
    orderId: number,
    dto: UpdateTripOrderDestinationDto,
  ): Promise<{
    success: boolean;
    tripCode: string;
    orderId: number;
    deliveryMode: string;
    destinationHubId: number | null;
    destinationHub: string | null;
    deliveryAddress: string | null;
    order: OrderEntity;
    trip: TripEntity;
  }> {
    const tripCode = normalizeTripCode(decodeURIComponent(tripCodeParam || ''));
    if (!tripCode) {
      throw new BadRequestException('Mã chuyến xe không hợp lệ');
    }

    const userWithHub = await this.loadUserWithHub(user);
    const operatingHubId = userWithHub.hubId ?? undefined;
    const perm = await this.validateTripStopEditPermission(
      user,
      tripCode,
      operatingHubId,
      'điều chuyển đích đến đơn hàng',
    );

    return await this.dataSource.transaction(async (manager) => {
      const txTripRepo = manager.getRepository(TripEntity);
      const txOrderRepo = manager.getRepository(OrderEntity);
      const txHubRepo = manager.getRepository(HubEntity);
      const txTripStopRepo = manager.getRepository(TripStopEntity);
      const txInvRepo = manager.getRepository(OrderInventoryTransactionEntity);

      // Verify trip allocation exists for this tripCode and orderId
      const trip = await txTripRepo.findOne({
        where: { tripCode, orderId, deletedAt: IsNull() },
      });
      if (!trip) {
        throw new NotFoundException(
          `Không tìm thấy liên kết giữa chuyến xe ${tripCode} và đơn hàng ID ${orderId}`,
        );
      }

      // Verify order exists
      const order = await txOrderRepo.findOne({
        where: { id: orderId, deletedAt: IsNull() },
        relations: ['originHubEntity', 'destinationHubEntity'],
      });
      if (!order) {
        throw new NotFoundException(`Không tìm thấy đơn hàng ID ${orderId}`);
      }

      let destHubName: string | null = null;
      let finalDestHubId: number | null = null;
      let finalDeliveryAddress: string | null =
        dto.deliveryAddress?.trim() || null;

      if (
        dto.deliveryMode === DeliveryModeEnum.HUB_L1 ||
        dto.deliveryMode === DeliveryModeEnum.XE_BO
      ) {
        if (!dto.destinationHubId) {
          throw new BadRequestException(
            'Cần cung cấp ID Hub đích cho hình thức giao hàng Hub Cấp 1 hoặc Tuyến Xe Bo',
          );
        }

        const hub = await txHubRepo.findOne({
          where: { id: dto.destinationHubId, deletedAt: IsNull() },
        });
        if (!hub) {
          throw new NotFoundException(
            `Không tìm thấy Hub đích với ID ${dto.destinationHubId}`,
          );
        }

        finalDestHubId = hub.id;
        destHubName = hub.name;
        finalDeliveryAddress = hub.name;

        // Master Contract Invariance (Task 41):
        // Update Trip destination only; NEVER overwrite OrderEntity master contract destination/route
        trip.destinationHubId = hub.id;
        trip.destinationHub = hub;
        trip.type = 'TRANSFER';
        trip.notes = `[XUẤT KHO - LUÂN CHUYỂN] Chuyển đến ${hub.name}`;

        // Tự động đảm bảo TripStopEntity tồn tại trên lộ trình xe nếu Hub đích chưa có trong trạm dừng
        const existingStop = await txTripStopRepo.findOne({
          where: { tripCode, hubId: hub.id, deletedAt: IsNull() },
        });
        if (!existingStop) {
          const maxStop = await txTripStopRepo.findOne({
            where: { tripCode, deletedAt: IsNull() },
            order: { stopSequence: 'DESC' },
          });
          const nextSeq =
            (maxStop?.stopSequence ? Number(maxStop.stopSequence) : 1) + 1;
          const newStop = txTripStopRepo.create({
            tripCode,
            hubId: hub.id,
            stopSequence: nextSeq,
            stopType: TripStopType.TRANSIT,
            status: TripStopStatus.PENDING,
          });
          await txTripStopRepo.save(newStop);
        }
      } else {
        // DIRECT_CUSTOMER
        finalDestHubId = null;
        destHubName = null;

        // Master Contract Invariance (Task 41):
        // Update Trip destination only; NEVER overwrite OrderEntity master contract destination/route
        trip.destinationHubId = null;
        trip.destinationHub = null as any;
        trip.type = 'OUTBOUND';
        trip.notes = `[XUẤT KHO - GIAO KHÁCH] Giao thẳng khách tại ${finalDeliveryAddress || 'địa chỉ khách'}`;
      }

      await txTripRepo.update(trip.id, {
        destinationHubId: finalDestHubId,
        type: trip.type,
        notes: trip.notes,
      });

      const savedOrder = order;
      const savedTrip =
        (await txTripRepo.findOne({
          where: { id: trip.id },
          relations: ['originHub', 'destinationHub'],
        })) || trip;

      // Ghi nhận nhật ký giao dịch kho (Inventory Transaction Audit)
      const currentHubId =
        (await this.resolveUserHubId(user)) ?? trip.originHubId ?? 2;
      const allocatedQty =
        Number(trip.quantityAllocated) ||
        Number(order.remainingQuantity) ||
        Number(order.totalQuantity) ||
        1;

      const txType = perm.isCompleted
        ? InventoryTransactionType.ADJUSTMENT
        : InventoryTransactionType.TRANSFER;

      await txInvRepo.save(
        txInvRepo.create({
          orderId: order.id,
          type: txType,
          hubId: currentHubId,
          tripId: trip.id,
          tripCode,
          quantity: allocatedQty,
          expectedQuantity: allocatedQty,
          discrepancyQuantity: 0,
          remainingQuantity: 0,
          weight:
            Number(trip.weightAllocated) || Number(order.totalWeight) || 0,
          volume:
            Number(trip.volumeAllocated) || Number(order.totalVolume) || 0,
          licensePlate: trip.licensePlate,
          driverName: trip.driverName,
          notes:
            dto.notes ||
            (perm.isCompleted
              ? `[ADMIN ĐIỀU CHUYỂN ĐÍCH] Quản trị viên cập nhật đích đến đơn ${order.orderCode} sang ${destHubName || finalDeliveryAddress || 'Giao khách'} (${dto.deliveryMode})`
              : `[ĐIỀU CHUYỂN ĐÍCH] Cập nhật đích đến đơn ${order.orderCode} sang ${destHubName || finalDeliveryAddress || 'Giao khách'} (${dto.deliveryMode})`),
          destination: destHubName || finalDeliveryAddress || '',
          performedByUserId: user.id,
        }),
      );

      return {
        success: true,
        tripCode,
        orderId: order.id,
        deliveryMode: dto.deliveryMode,
        destinationHubId: finalDestHubId,
        destinationHub: destHubName,
        deliveryAddress: finalDeliveryAddress,
        order: savedOrder,
        trip: savedTrip,
      };
    });
  }

  /**
   * Mở lại chuyến xe đã xử lý về trạng thái Chờ xử lý (Rollback Inbound/Outbound Trip).
   * Dành riêng cho Super Admin.
   * Hoàn tác số lượng tồn kho, trạng thái đơn hàng và chuyển trip/stop về PENDING.
   */
  async rollbackTrip(
    user: UserEntity,
    tripCodeParam: string,
    dto?: { reason?: string; hubId?: number },
    bearerToken?: string | null,
  ): Promise<{
    success: boolean;
    tripCode: string;
    tripType: string;
    affectedOrdersCount: number;
    message: string;
  }> {
    const userWithHub = await this.userRepository.findOne({
      where: { id: user.id },
      relations: ['hub', 'role'],
    });
    const roleId = Number(
      userWithHub?.role?.id ?? user.role?.id ?? (user.role as any),
    );
    const roleName =
      userWithHub?.role?.name ||
      (typeof user.role === 'string' ? user.role : (user.role as any)?.name) ||
      '';
    const isAdmin =
      roleId === RoleEnum.SUPER_ADMIN ||
      roleName === 'SUPER_ADMIN' ||
      (user.role as any) === 'SUPER_ADMIN';

    if (!isAdmin) {
      throw new ForbiddenException(
        'Chỉ Quản trị viên (Super Admin) mới có quyền mở lại chuyến xe đã xử lý.',
      );
    }

    const normTripCode = normalizeTripCode(
      decodeURIComponent(tripCodeParam || ''),
    );
    if (!normTripCode) {
      throw new NotFoundException('Mã chuyến xe không hợp lệ');
    }

    const operatingHubId =
      dto?.hubId ?? userWithHub?.hubId ?? user.hubId ?? null;

    return this.dataSource.transaction(async (manager) => {
      const stopRepo = manager.getRepository(TripStopEntity);
      const tripRepo = manager.getRepository(TripEntity);
      const txRepo = manager.getRepository(OrderInventoryTransactionEntity);
      const orderRepo = manager.getRepository(OrderEntity);

      const stops = await stopRepo.find({
        where: { tripCode: normTripCode },
        relations: ['hub'],
      });
      const trips = await tripRepo.find({
        where: { tripCode: normTripCode },
      });

      if (stops.length === 0 && trips.length === 0) {
        throw new NotFoundException(
          `Không tìm thấy dữ liệu chuyến xe ${normTripCode}`,
        );
      }

      // Xác định loại chuyến xe (Xuất kho vs Nhập kho)
      let isOutbound = trips.some(
        (t) => t.type === 'OUTBOUND' || t.type === 'TRANSFER',
      );
      if (!isOutbound && operatingHubId) {
        const matchingStop = stops.find((s) => s.hubId === operatingHubId);
        if (matchingStop && matchingStop.stopType === TripStopType.ORIGIN) {
          isOutbound = true;
        }
      }

      const affectedOrderIds = new Set<number>();

      if (isOutbound) {
        // === ROLLBACK XUẤT KHO ===
        const txQb = txRepo
          .createQueryBuilder('tx')
          .where('tx.tripCode = :tripCode', { tripCode: normTripCode })
          .andWhere('tx.type IN (:...types)', {
            types: [
              InventoryTransactionType.OUTBOUND,
              InventoryTransactionType.TRANSFER,
            ],
          })
          .andWhere('tx.deletedAt IS NULL');

        if (operatingHubId) {
          txQb.andWhere('tx.hubId = :hubId', { hubId: operatingHubId });
        }
        const txList = await txQb.getMany();

        for (const tx of txList) {
          affectedOrderIds.add(tx.orderId);
          const order = await orderRepo.findOne({ where: { id: tx.orderId } });
          if (order) {
            const qty = Number(tx.quantity) || 0;
            order.outboundQuantity = Math.max(
              0,
              (Number(order.outboundQuantity) || 0) - qty,
            );
            order.remainingQuantity =
              (Number(order.remainingQuantity) || 0) + qty;
            order.status = 'INBOUND'; // Khôi phục trạng thái LƯU KHO tại Hub
            if (tx.hubId) {
              order.currentHubId = tx.hubId;
            }
            if (order.currentTripCode === normTripCode) {
              order.currentTripCode = null;
            }
            await orderRepo.save(order);
          }
        }

        for (const t of trips) {
          affectedOrderIds.add(t.orderId);
          if (
            t.quantityAllocated === null ||
            t.quantityAllocated === undefined
          ) {
            const matchingTx = txList.find((tx) => tx.orderId === t.orderId);
            t.quantityAllocated = Number(matchingTx?.quantity) || 1;
            await tripRepo.save(t);
          }
          const order = await orderRepo.findOne({ where: { id: t.orderId } });
          if (order && order.currentTripCode === normTripCode) {
            order.currentTripCode = null;
            await orderRepo.save(order);
          }
        }

        // Đánh dấu xóa giao dịch xuất kho
        if (txList.length > 0) {
          await manager.query(
            `UPDATE "order_inventory_transaction" SET "deletedAt" = NOW()
             WHERE "tripCode" = $1 AND "type" IN ('OUTBOUND', 'TRANSFER') AND "deletedAt" IS NULL
             ${operatingHubId ? 'AND "hubId" = $2' : ''}`,
            operatingHubId ? [normTripCode, operatingHubId] : [normTripCode],
          );
        }

        // Cập nhật trip_stop về PENDING
        await manager.query(
          `UPDATE "trip_stop" SET "status" = 'PENDING', "updatedAt" = NOW()
           WHERE "tripCode" = $1 AND "deletedAt" IS NULL
           ${operatingHubId ? 'AND "hubId" = $2' : ''}`,
          operatingHubId ? [normTripCode, operatingHubId] : [normTripCode],
        );

        // Cập nhật trip về PENDING
        await manager.query(
          `UPDATE "trip" SET "status" = 'PENDING', "updatedAt" = NOW()
           WHERE "tripCode" = $1 AND "deletedAt" IS NULL`,
          [normTripCode],
        );
      } else {
        // === ROLLBACK NHẬP KHO ===
        const txQb = txRepo
          .createQueryBuilder('tx')
          .where('tx.tripCode = :tripCode', { tripCode: normTripCode })
          .andWhere('tx.type = :type', {
            type: InventoryTransactionType.INBOUND,
          })
          .andWhere('tx.deletedAt IS NULL');

        if (operatingHubId) {
          txQb.andWhere('tx.hubId = :hubId', { hubId: operatingHubId });
        }
        const txList = await txQb.getMany();

        for (const tx of txList) {
          affectedOrderIds.add(tx.orderId);
          const order = await orderRepo.findOne({ where: { id: tx.orderId } });
          if (order) {
            const qty = Number(tx.quantity) || 0;
            order.inboundQuantity = Math.max(
              0,
              (Number(order.inboundQuantity) || 0) - qty,
            );
            order.remainingQuantity = Math.max(
              0,
              (Number(order.remainingQuantity) || 0) - qty,
            );

            if (order.remainingQuantity === 0) {
              if (
                order.originHubId &&
                tx.hubId &&
                order.originHubId !== tx.hubId
              ) {
                order.status = 'IN_TRANSIT';
                order.currentTripCode = normTripCode;
              } else {
                order.status = 'WAITING';
              }
            }
            await orderRepo.save(order);
          }
        }

        for (const t of trips) {
          affectedOrderIds.add(t.orderId);
        }

        // Đánh dấu xóa giao dịch nhập kho
        if (txList.length > 0) {
          await manager.query(
            `UPDATE "order_inventory_transaction" SET "deletedAt" = NOW()
             WHERE "tripCode" = $1 AND "type" = 'INBOUND' AND "deletedAt" IS NULL
             ${operatingHubId ? 'AND "hubId" = $2' : ''}`,
            operatingHubId ? [normTripCode, operatingHubId] : [normTripCode],
          );
        }

        // Cập nhật trip_stop về PENDING
        await manager.query(
          `UPDATE "trip_stop" SET "status" = 'PENDING', "updatedAt" = NOW()
           WHERE "tripCode" = $1 AND "deletedAt" IS NULL
           ${operatingHubId ? 'AND "hubId" = $2' : ''}`,
          operatingHubId ? [normTripCode, operatingHubId] : [normTripCode],
        );

        // Cập nhật trip về PENDING
        await manager.query(
          `UPDATE "trip" SET "status" = 'PENDING', "updatedAt" = NOW()
           WHERE "tripCode" = $1 AND "deletedAt" IS NULL`,
          [normTripCode],
        );
      }

      // Record Order Activity Log for all affected orders
      for (const orderId of affectedOrderIds) {
        const ord = await orderRepo.findOne({ where: { id: orderId } });
        if (ord) {
          await this.activityLogService.logActivity(
            {
              orderId: ord.id,
              orderCode: ord.orderCode,
              action: OrderActivityAction.TRIP_ROLLBACK,
              actorUserId: Number(user.id),
              actorEmail: user.email,
              actorRole: 'SUPER_ADMIN',
              hubId: Number(
                operatingHubId || ord.currentHubId || ord.originHubId,
              ),
              hubName: ord.originHub || 'Hub',
              tripCode: normTripCode,
              quantity: ord.remainingQuantity ?? 0,
              reason: dto?.reason?.trim() || 'Admin rollback chuyến xe',
              bearerToken: bearerToken ?? null,
              newValues: {
                tripCode: normTripCode,
                tripType: isOutbound ? 'OUTBOUND' : 'INBOUND',
                status: ord.status,
                remainingQuantity: ord.remainingQuantity,
              },
            },
            manager,
          );
        }
      }

      this.logger.log(
        `[ADMIN ROLLBACK TRIP] Quản trị viên ${user.id} (${user.email || 'Admin'}) đã rollback chuyến xe ${normTripCode} (${isOutbound ? 'XUẤT KHO' : 'NHẬP KHO'}) về trạng thái PENDING. Lý do: ${dto?.reason || 'Không ghi nhận'}. Đơn hàng bị ảnh hưởng: ${affectedOrderIds.size}`,
      );

      return {
        success: true,
        tripCode: normTripCode,
        tripType: isOutbound ? 'OUTBOUND' : 'INBOUND',
        affectedOrdersCount: affectedOrderIds.size,
        message: `Đã mở lại chuyến xe ${normTripCode} thành công. Chuyến xe và tồn kho hàng hóa đã được hoàn tác về trạng thái Chờ xử lý.`,
      };
    });
  }

  /**
   * ACID Transaction: Soft-delete an inventory transaction line.
   * Only accessible by SUPER_ADMIN.
   * Enforces invariant: newTotalInbound >= newTotalOutbound.
   * Recalculates order quantities and status, updates sibling orders sharing orderCode.
   * Records immutable OrderActivityLog with actorUserId, hubId, reason and bearerToken.
   */
  async deleteTransaction(
    transactionId: number,
    user: UserEntity,
    reason?: string,
    bearerToken?: string | null,
  ) {
    const roleId = Number(
      user?.role?.id || (typeof user?.role === 'number' ? user.role : 0),
    );
    const roleName = String(
      (user?.role as any)?.name || user?.role || '',
    ).toUpperCase();
    const isSuperAdmin =
      roleId === RoleEnum.SUPER_ADMIN ||
      roleName === 'SUPER_ADMIN' ||
      roleName === 'ADMIN';

    if (!isSuperAdmin) {
      throw new ForbiddenException(
        'Chỉ Quản trị viên (Super Admin) mới có quyền xóa dòng giao dịch kho.',
      );
    }

    const auditReason = reason?.trim() || 'Admin xóa dòng giao dịch kho';
    const userWithHub = await this.loadUserWithHub(user);
    const actorEmail = userWithHub.email;
    const actorUserId = Number(userWithHub.id);
    const actorRole =
      (typeof userWithHub.role === 'object'
        ? userWithHub.role?.name
        : userWithHub.role) || 'SUPER_ADMIN';

    return this.dataSource.transaction(async (manager) => {
      const txRepo = manager.getRepository(OrderInventoryTransactionEntity);
      const orderRepo = manager.getRepository(OrderEntity);

      const tx = await txRepo.findOne({
        where: { id: transactionId },
        relations: ['order', 'hub'],
        withDeleted: true,
      });

      if (!tx) {
        throw new NotFoundException('Không tìm thấy giao dịch kho cần xóa.');
      }

      if (tx.deletedAt) {
        throw new BadRequestException(
          'Dòng giao dịch này đã được xóa trước đó.',
        );
      }

      const order = await orderRepo.findOne({
        where: { id: tx.orderId },
      });

      if (!order) {
        throw new NotFoundException(
          `Không tìm thấy đơn hàng liên kết (orderId: ${tx.orderId}).`,
        );
      }

      // Soft delete the transaction line
      await txRepo.softDelete(transactionId);

      // Query all remaining active transactions for this orderCode
      const siblingOrders = await orderRepo.find({
        where: { orderCode: order.orderCode.trim() },
        select: ['id'],
      });
      const siblingOrderIds = siblingOrders.map((o) => o.id);

      const remainingActiveTxs = await txRepo.find({
        where: { orderId: In(siblingOrderIds) },
        order: { createdAt: 'ASC' },
      });

      const newTotalInbound = remainingActiveTxs
        .filter((t) => t.type === 'INBOUND')
        .reduce((sum, t) => sum + (Number(t.quantity) || 0), 0);

      const newTotalOutbound = remainingActiveTxs
        .filter((t) => t.type === 'OUTBOUND' || t.type === 'TRANSFER')
        .reduce((sum, t) => sum + (Number(t.quantity) || 0), 0);

      if (newTotalInbound < newTotalOutbound) {
        throw new BadRequestException(
          `Không thể xóa dòng giao dịch này vì sẽ gây âm kho! (Tổng nhập còn lại: ${newTotalInbound} kiện, nhưng tổng xuất đã là: ${newTotalOutbound} kiện).`,
        );
      }

      const newRemaining = Math.max(0, newTotalInbound - newTotalOutbound);
      let newStatus = order.status;
      if (newTotalInbound === 0) {
        newStatus = 'PENDING';
      } else if (newRemaining === 0 && newTotalOutbound > 0) {
        newStatus = 'COMPLETED_OUTBOUND';
      } else if (newTotalOutbound > 0 && newRemaining > 0) {
        newStatus = 'PARTIALLY_DELIVERED';
      } else {
        newStatus = 'STORED';
      }

      const oldValues = {
        totalQuantity: order.totalQuantity,
        inboundQuantity: order.inboundQuantity,
        outboundQuantity: order.outboundQuantity,
        remainingQuantity: order.remainingQuantity,
        status: order.status,
      };

      // Sync across all sibling order records sharing orderCode
      for (const sibId of siblingOrderIds) {
        await orderRepo.update(sibId, {
          totalQuantity: newTotalInbound,
          inboundQuantity: newTotalInbound,
          outboundQuantity: newTotalOutbound,
          remainingQuantity: newRemaining,
          status: newStatus,
          updatedAt: new Date(),
        });
      }

      const newValues = {
        totalQuantity: newTotalInbound,
        inboundQuantity: newTotalInbound,
        outboundQuantity: newTotalOutbound,
        remainingQuantity: newRemaining,
        status: newStatus,
        transactionId: tx.id,
        transactionType: tx.type,
        quantity: tx.quantity,
      };

      // Record Activity Log with actorUserId, hubId, reason and bearerToken
      await this.activityLogService.logActivity(
        {
          orderId: order.id,
          orderCode: order.orderCode,
          action: OrderActivityAction.TRANSACTION_DELETED,
          actorUserId,
          actorEmail,
          actorRole,
          hubId: Number(tx.hubId || order.currentHubId || order.originHubId),
          hubName: tx.hub?.name || order.originHub || 'N/A Hub',
          tripCode: tx.tripCode || null,
          quantity: tx.quantity,
          reason: auditReason,
          bearerToken: bearerToken ?? null,
          oldValues,
          newValues,
          metadata: {
            transactionId: tx.id,
            invoiceCode: tx.invoiceCode,
            licensePlate: tx.licensePlate,
            driverName: tx.driverName,
            txType: tx.type,
          },
        },
        manager,
      );

      return {
        success: true,
        message: `Đã xóa dòng giao dịch #${transactionId} (${tx.type} ${tx.quantity} kiện) thành công. Tồn kho đã được cân bằng lại.`,
        transactionId,
        orderCode: order.orderCode,
        inboundQuantity: newTotalInbound,
        outboundQuantity: newTotalOutbound,
        remainingQuantity: newRemaining,
      };
    });
  }

  /**
   * ACID Transaction: Restore a soft-deleted inventory transaction line.
   * Only accessible by SUPER_ADMIN.
   * Enforces invariant: newTotalInbound >= newTotalOutbound.
   * Recalculates order quantities and status, updates sibling orders sharing orderCode.
   * Records immutable OrderActivityLog with actorUserId, hubId, reason and bearerToken.
   */
  async restoreTransaction(
    transactionId: number,
    user: UserEntity,
    reason?: string,
    bearerToken?: string | null,
  ) {
    const roleId = Number(
      user?.role?.id || (typeof user?.role === 'number' ? user.role : 0),
    );
    const roleName = String(
      (user?.role as any)?.name || user?.role || '',
    ).toUpperCase();
    const isSuperAdmin =
      roleId === RoleEnum.SUPER_ADMIN ||
      roleName === 'SUPER_ADMIN' ||
      roleName === 'ADMIN';

    if (!isSuperAdmin) {
      throw new ForbiddenException(
        'Chỉ Quản trị viên (Super Admin) mới có quyền khôi phục dòng giao dịch kho.',
      );
    }

    const auditReason = reason?.trim() || 'Admin khôi phục dòng giao dịch kho';
    const userWithHub = await this.loadUserWithHub(user);
    const actorEmail = userWithHub.email;
    const actorUserId = Number(userWithHub.id);
    const actorRole =
      (typeof userWithHub.role === 'object'
        ? userWithHub.role?.name
        : userWithHub.role) || 'SUPER_ADMIN';

    return this.dataSource.transaction(async (manager) => {
      const txRepo = manager.getRepository(OrderInventoryTransactionEntity);
      const orderRepo = manager.getRepository(OrderEntity);

      const tx = await txRepo.findOne({
        where: { id: transactionId },
        relations: ['order', 'hub'],
        withDeleted: true,
      });

      if (!tx) {
        throw new NotFoundException(
          'Không tìm thấy giao dịch kho cần khôi phục.',
        );
      }

      if (!tx.deletedAt) {
        throw new BadRequestException(
          'Dòng giao dịch này đang hoạt động bình thường, không cần khôi phục.',
        );
      }

      const order = await orderRepo.findOne({
        where: { id: tx.orderId },
      });

      if (!order) {
        throw new NotFoundException(
          `Không tìm thấy đơn hàng liên kết (orderId: ${tx.orderId}).`,
        );
      }

      // Restore the transaction line
      await txRepo.restore(transactionId);

      const siblingOrders = await orderRepo.find({
        where: { orderCode: order.orderCode.trim() },
        select: ['id'],
      });
      const siblingOrderIds = siblingOrders.map((o) => o.id);

      const restoredActiveTxs = await txRepo.find({
        where: { orderId: In(siblingOrderIds) },
        order: { createdAt: 'ASC' },
      });

      const newTotalInbound = restoredActiveTxs
        .filter((t) => t.type === 'INBOUND')
        .reduce((sum, t) => sum + (Number(t.quantity) || 0), 0);

      const newTotalOutbound = restoredActiveTxs
        .filter((t) => t.type === 'OUTBOUND' || t.type === 'TRANSFER')
        .reduce((sum, t) => sum + (Number(t.quantity) || 0), 0);

      if (newTotalInbound < newTotalOutbound) {
        throw new BadRequestException(
          `Không thể khôi phục dòng giao dịch này vì sẽ gây âm kho! (Tổng nhập: ${newTotalInbound} kiện, tổng xuất: ${newTotalOutbound} kiện).`,
        );
      }

      const newRemaining = Math.max(0, newTotalInbound - newTotalOutbound);
      let newStatus = order.status;
      if (newTotalInbound === 0) {
        newStatus = 'PENDING';
      } else if (newRemaining === 0 && newTotalOutbound > 0) {
        newStatus = 'COMPLETED_OUTBOUND';
      } else if (newTotalOutbound > 0 && newRemaining > 0) {
        newStatus = 'PARTIALLY_DELIVERED';
      } else {
        newStatus = 'STORED';
      }

      const oldValues = {
        totalQuantity: order.totalQuantity,
        inboundQuantity: order.inboundQuantity,
        outboundQuantity: order.outboundQuantity,
        remainingQuantity: order.remainingQuantity,
        status: order.status,
      };

      for (const sibId of siblingOrderIds) {
        await orderRepo.update(sibId, {
          totalQuantity: newTotalInbound,
          inboundQuantity: newTotalInbound,
          outboundQuantity: newTotalOutbound,
          remainingQuantity: newRemaining,
          status: newStatus,
          updatedAt: new Date(),
        });
      }

      const newValues = {
        totalQuantity: newTotalInbound,
        inboundQuantity: newTotalInbound,
        outboundQuantity: newTotalOutbound,
        remainingQuantity: newRemaining,
        status: newStatus,
        transactionId: tx.id,
        transactionType: tx.type,
        quantity: tx.quantity,
      };

      // Record Activity Log with actorUserId, hubId, reason and bearerToken
      await this.activityLogService.logActivity(
        {
          orderId: order.id,
          orderCode: order.orderCode,
          action: OrderActivityAction.TRANSACTION_RESTORED,
          actorUserId,
          actorEmail,
          actorRole,
          hubId: Number(tx.hubId || order.currentHubId || order.originHubId),
          hubName: tx.hub?.name || order.originHub || 'N/A Hub',
          tripCode: tx.tripCode || null,
          quantity: tx.quantity,
          reason: auditReason,
          bearerToken: bearerToken ?? null,
          oldValues,
          newValues,
          metadata: {
            transactionId: tx.id,
            invoiceCode: tx.invoiceCode,
            licensePlate: tx.licensePlate,
            driverName: tx.driverName,
            txType: tx.type,
          },
        },
        manager,
      );

      return {
        success: true,
        message: `Đã hoàn tác dòng giao dịch #${transactionId} (${tx.type} ${tx.quantity} kiện) thành công. Tồn kho đã được cân bằng lại.`,
        transactionId,
        orderCode: order.orderCode,
        inboundQuantity: newTotalInbound,
        outboundQuantity: newTotalOutbound,
        remainingQuantity: newRemaining,
      };
    });
  }

  /**
   * ACID Transaction: Update package quantity of an active inventory transaction line.
   * Only accessible by SUPER_ADMIN.
   * Enforces invariant: newTotalInbound >= newTotalOutbound and recalculates running balances & sibling orders.
   * Records immutable OrderActivityLog with action TRANSACTION_UPDATED.
   */
  async updateTransactionQuantity(
    transactionId: number,
    newQuantity: number,
    user: UserEntity,
    reason?: string,
    bearerToken?: string | null,
  ) {
    const roleId = Number(
      user?.role?.id || (typeof user?.role === 'number' ? user.role : 0),
    );
    const roleName = String(
      (user?.role as any)?.name || user?.role || '',
    ).toUpperCase();
    const isSuperAdmin =
      roleId === RoleEnum.SUPER_ADMIN ||
      roleName === 'SUPER_ADMIN' ||
      roleName === 'SUPER ADMIN' ||
      roleName === 'ADMIN';

    if (!isSuperAdmin) {
      throw new ForbiddenException(
        'Chỉ Quản trị viên (Super Admin) mới có quyền điều chỉnh số lượng kiện giao dịch kho.',
      );
    }

    const parsedQty = Number(newQuantity);
    if (
      !Number.isFinite(parsedQty) ||
      parsedQty < 1 ||
      !Number.isInteger(parsedQty)
    ) {
      throw new BadRequestException(
        'Số lượng kiện điều chỉnh phải là số nguyên lớn hơn hoặc bằng 1.',
      );
    }

    const auditReason =
      reason?.trim() || 'Admin điều chỉnh số lượng kiện giao dịch kho';
    const userWithHub = await this.loadUserWithHub(user);
    const actorEmail = userWithHub.email;
    const actorUserId = Number(userWithHub.id);
    const actorRole =
      (typeof userWithHub.role === 'object'
        ? userWithHub.role?.name
        : userWithHub.role) || 'SUPER_ADMIN';

    return this.dataSource.transaction(async (manager) => {
      const txRepo = manager.getRepository(OrderInventoryTransactionEntity);
      const orderRepo = manager.getRepository(OrderEntity);
      const tripRepo = manager.getRepository(TripEntity);

      const tx = await txRepo.findOne({
        where: { id: transactionId },
        relations: ['order', 'hub'],
        withDeleted: true,
      });

      if (!tx) {
        throw new NotFoundException(
          'Không tìm thấy giao dịch kho cần điều chỉnh.',
        );
      }

      if (tx.deletedAt) {
        throw new BadRequestException(
          'Không thể điều chỉnh số lượng trên dòng giao dịch đã bị xóa. Vui lòng hoàn tác dòng xóa trước.',
        );
      }

      const order = await orderRepo.findOne({
        where: { id: tx.orderId },
      });

      if (!order) {
        throw new NotFoundException(
          `Không tìm thấy đơn hàng liên kết (orderId: ${tx.orderId}).`,
        );
      }

      const oldTxQuantity = Number(tx.quantity) || 0;

      // Update transaction quantity
      await txRepo.update(transactionId, {
        quantity: parsedQty,
      });

      // Query all active transactions for this orderCode
      const siblingOrders = await orderRepo.find({
        where: { orderCode: order.orderCode.trim() },
        select: ['id'],
      });
      const siblingOrderIds = siblingOrders.map((o) => o.id);

      const activeTxs = await txRepo.find({
        where: { orderId: In(siblingOrderIds) },
        order: { createdAt: 'ASC', id: 'ASC' },
      });

      const newTotalInbound = activeTxs
        .filter((t) => t.type === 'INBOUND')
        .reduce((sum, t) => sum + (Number(t.quantity) || 0), 0);

      const newTotalOutbound = activeTxs
        .filter((t) => t.type === 'OUTBOUND' || t.type === 'TRANSFER')
        .reduce((sum, t) => sum + (Number(t.quantity) || 0), 0);

      if (newTotalInbound < newTotalOutbound) {
        throw new BadRequestException(
          `Không thể điều chỉnh thành ${parsedQty} kiện vì sẽ gây âm kho! (Tổng nhập sau điều chỉnh: ${newTotalInbound} kiện, nhưng tổng xuất đã là: ${newTotalOutbound} kiện).`,
        );
      }

      // Update chronological running balance on each active transaction
      let runningStock = 0;
      for (const activeTx of activeTxs) {
        const q = Number(activeTx.quantity) || 0;
        if (activeTx.type === 'INBOUND') {
          runningStock += q;
        } else {
          runningStock = Math.max(0, runningStock - q);
        }
        if (Number(activeTx.remainingQuantity) !== runningStock) {
          await txRepo.update(activeTx.id, { remainingQuantity: runningStock });
        }
      }

      // Sync TripEntity.quantityAllocated if linked to a tripCode
      if (tx.tripCode) {
        const matchingTrips = await tripRepo.find({
          where: {
            orderId: In(siblingOrderIds),
            tripCode: tx.tripCode,
          },
        });
        for (const mt of matchingTrips) {
          await tripRepo.update(mt.id, { quantityAllocated: parsedQty });
        }
      }

      const newRemaining = Math.max(0, newTotalInbound - newTotalOutbound);
      let newStatus = order.status;
      if (newTotalInbound === 0) {
        newStatus = 'PENDING';
      } else if (newRemaining === 0 && newTotalOutbound > 0) {
        newStatus = 'COMPLETED_OUTBOUND';
      } else if (newTotalOutbound > 0 && newRemaining > 0) {
        newStatus = 'PARTIALLY_DELIVERED';
      } else {
        newStatus = 'STORED';
      }

      const oldValues = {
        totalQuantity: order.totalQuantity,
        inboundQuantity: order.inboundQuantity,
        outboundQuantity: order.outboundQuantity,
        remainingQuantity: order.remainingQuantity,
        status: order.status,
        transactionId: tx.id,
        transactionType: tx.type,
        quantity: oldTxQuantity,
      };

      for (const sibId of siblingOrderIds) {
        await orderRepo.update(sibId, {
          totalQuantity: newTotalInbound,
          inboundQuantity: newTotalInbound,
          outboundQuantity: newTotalOutbound,
          remainingQuantity: newRemaining,
          status: newStatus,
          updatedAt: new Date(),
        });
      }

      const newValues = {
        totalQuantity: newTotalInbound,
        inboundQuantity: newTotalInbound,
        outboundQuantity: newTotalOutbound,
        remainingQuantity: newRemaining,
        status: newStatus,
        transactionId: tx.id,
        transactionType: tx.type,
        oldQuantity: oldTxQuantity,
        quantity: parsedQty,
      };

      await this.activityLogService.logActivity(
        {
          orderId: order.id,
          orderCode: order.orderCode,
          action: OrderActivityAction.TRANSACTION_UPDATED,
          actorUserId,
          actorEmail,
          actorRole,
          hubId: Number(
            tx.hubId || order.currentHubId || order.originHubId || 0,
          ),
          hubName: tx.hub?.name || order.originHub || 'N/A Hub',
          tripCode: tx.tripCode || null,
          quantity: parsedQty,
          reason: auditReason,
          bearerToken: bearerToken ?? null,
          oldValues,
          newValues,
          metadata: {
            transactionId: tx.id,
            invoiceCode: tx.invoiceCode,
            licensePlate: tx.licensePlate,
            driverName: tx.driverName,
            txType: tx.type,
            oldQuantity: oldTxQuantity,
            newQuantity: parsedQty,
          },
        },
        manager,
      );

      return {
        success: true,
        message: `Đã điều chỉnh số lượng giao dịch #${transactionId} (${tx.type}: ${oldTxQuantity} → ${parsedQty} kiện) thành công. Tồn kho đã được cân bằng lại.`,
        transactionId,
        orderCode: order.orderCode,
        oldQuantity: oldTxQuantity,
        quantity: parsedQty,
        inboundQuantity: newTotalInbound,
        outboundQuantity: newTotalOutbound,
        remainingQuantity: newRemaining,
      };
    });
  }

  /**
   * Get all chronological order inventory transactions (including soft-deleted).
   */
  async getOrderTransactions(orderCode: string, user?: UserEntity) {
    const orderRepo = this.dataSource.getRepository(OrderEntity);
    const txRepo = this.dataSource.getRepository(
      OrderInventoryTransactionEntity,
    );

    const orders = await orderRepo.find({
      where: { orderCode: orderCode.trim() },
      select: [
        'id',
        'orderCode',
        'totalQuantity',
        'inboundQuantity',
        'outboundQuantity',
        'remainingQuantity',
        'status',
      ],
    });

    if (orders.length === 0) {
      throw new NotFoundException(
        `Không tìm thấy đơn hàng với mã '${orderCode}'`,
      );
    }

    const order = orders[0];
    const orderIds = orders.map((o) => o.id);

    const rawTxs = await txRepo
      .createQueryBuilder('tx')
      .withDeleted()
      .leftJoinAndSelect('tx.hub', 'hub')
      .where('tx.orderId IN (:...orderIds)', { orderIds })
      .orderBy('tx.createdAt', 'ASC')
      .addOrderBy('tx.id', 'ASC')
      .getMany();

    // Map running balance on active transactions
    let running = 0;
    const transactions = rawTxs.map((tx) => {
      const isDeleted = !!tx.deletedAt;
      const isIn = tx.type === 'INBOUND';
      const q = Number(tx.quantity) || 0;
      if (!isDeleted) {
        if (isIn) {
          running += q;
        } else {
          running = Math.max(0, running - q);
        }
      }
      return {
        id: tx.id,
        orderId: tx.orderId,
        type: tx.type,
        invoiceCode: tx.invoiceCode,
        hubId: tx.hubId,
        hubName: tx.hub?.name || null,
        tripCode: tx.tripCode,
        licensePlate: tx.licensePlate,
        driverName: tx.driverName,
        quantity: tx.quantity,
        remainingQuantity: tx.remainingQuantity,
        weight: tx.weight,
        volume: tx.volume,
        destination: tx.destination,
        notes: tx.notes,
        deletedAt: tx.deletedAt,
        createdAt: tx.createdAt,
        isDeleted,
        cumulativeStock: isDeleted ? null : running,
      };
    });

    const roleId = Number(
      user?.role?.id || (typeof user?.role === 'number' ? user.role : 0),
    );
    const roleName = String(
      (user?.role as any)?.name || user?.role || '',
    ).toUpperCase();
    const isSuperAdmin =
      roleId === RoleEnum.SUPER_ADMIN ||
      roleName === 'SUPER_ADMIN' ||
      roleName === 'SUPER ADMIN' ||
      roleName === 'ADMIN';

    return {
      userRole: isSuperAdmin ? 'SUPER_ADMIN' : roleName || null,
      order: {
        id: order.id,
        orderCode: order.orderCode,
        totalQuantity: order.totalQuantity,
        inboundQuantity: order.inboundQuantity,
        outboundQuantity: order.outboundQuantity,
        remainingQuantity: order.remainingQuantity,
        status: order.status,
      },
      transactions,
    };
  }
}
