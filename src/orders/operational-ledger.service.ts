import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { HubEntity } from '../hubs/infrastructure/persistence/relational/entities/hub.entity';
import { InventoryTransactionType } from './infrastructure/persistence/relational/entities/order-inventory-transaction.entity';
import {
  TripStopStatus,
  TripStopType,
} from '../trips/infrastructure/persistence/relational/entities/trip-stop.entity';
import { OrderCodeService } from './order-code.service';

/** Statuses meaning "order still a draft at its creating hub". */
export const DRAFT_LIKE_STATUSES = ['DRAFT', 'PENDING', 'WAITING'];

/**
 * Master Contract fields — immutable once the order leaves DRAFT.
 * Only SUPER_ADMIN may change them via PATCH /orders/:id/admin-override (with audit reason).
 */
export const CONTRACT_FIELDS = [
  'orderCode',
  'totalQuantity',
  'totalWeight',
  'totalVolume',
  'goodsDescription',
  'originHub',
  'originHubId',
  'destinationHub',
  'destinationHubId',
  'route',
] as const;

const INVOICE_PREFIX: Record<string, string> = {
  [InventoryTransactionType.INBOUND]: 'PNK', // Phiếu nhập kho
  [InventoryTransactionType.TRANSFER]: 'PXK', // Phiếu xuất luân chuyển
  [InventoryTransactionType.OUTBOUND]: 'PGH', // Phiếu giao hàng khách
  [InventoryTransactionType.ADJUSTMENT]: 'DCH', // Phiếu điều chỉnh hợp đồng
};

export interface UpsertTripStopInput {
  tripCode: string;
  hubId: number;
  status: TripStopStatus;
  stopType?: TripStopType;
  stopSequence?: number;
  userId?: number | null;
}

/**
 * Operational ledger helpers shared by Warehouse, Orders and Trips services:
 *  - SD trip code allocation (global Postgres sequence)
 *  - Invoice code allocation (atomic counter per hub / type / month)
 *  - Trip stop upsert (per-hub trip status, never downgrades COMPLETED)
 *  - Per-hub stock computed from the invoice ledger
 *  - SQL fragments resolving an order's status from the viewer hub's perspective
 */
@Injectable()
export class OperationalLedgerService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly orderCodeService: OrderCodeService,
  ) {}

  private em(manager?: EntityManager): EntityManager {
    return manager || this.dataSource.manager;
  }

  /** Allocate the next global short trip code: SD1, SD2, ... SD101 ... */
  async generateTripCode(manager?: EntityManager): Promise<string> {
    const rows = await this.em(manager).query(
      `SELECT nextval('trip_code_sd_seq') AS "seq"`,
    );
    return `SD${Number(rows?.[0]?.seq)}`;
  }

  /** Short hub code used inside invoice codes (e.g. HCM, HYN). */
  private resolveHubCode(hub: HubEntity | null): string {
    if (!hub) return 'HQ';
    if (hub.orderCodePrefix) return hub.orderCodePrefix;
    return (
      hub.code
        ?.replace(/^HUB-/, '')
        .replace(/-01$/, '')
        .replace(/-/g, '_') || 'HUB'
    );
  }

  /**
   * Allocate an invoice code atomically: {PNK|PXK|PGH|DCH}-{HUB}-{YYMM}-{SEQ}.
   * Reuses `order_code_counter` with a reserved key (`INV-XXX`) that cannot collide with
   * operator initials (initials never contain '-').
   */
  async generateInvoiceCode(
    type: InventoryTransactionType | string,
    hubId: number | null | undefined,
    manager?: EntityManager,
  ): Promise<string> {
    const em = this.em(manager);
    const prefix = INVOICE_PREFIX[type] || 'PGD';
    const hub = hubId
      ? await em.findOne(HubEntity, { where: { id: hubId } })
      : null;
    const hubCode = this.resolveHubCode(hub);
    const yearMonth = this.orderCodeService.getYearMonthPeriod();

    const result = await em.query(
      `INSERT INTO "order_code_counter" ("hubId", "operatorInitials", "yearMonth", "lastSequence", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 1, NOW(), NOW())
       ON CONFLICT ("hubId", "operatorInitials", "yearMonth")
       DO UPDATE SET "lastSequence" = "order_code_counter"."lastSequence" + 1, "updatedAt" = NOW()
       RETURNING "lastSequence"`,
      [hub?.id ?? 0, `INV-${prefix}`, yearMonth],
    );
    const seq = Number(result?.[0]?.lastSequence) || 1;
    const seqStr = seq < 1000 ? String(seq).padStart(3, '0') : String(seq);
    return `${prefix}-${hubCode}-${yearMonth}-${seqStr}`;
  }

  /**
   * Create or update the stop of a logical trip at a hub.
   * A COMPLETED stop is never downgraded back to PENDING.
   */
  async upsertTripStop(
    input: UpsertTripStopInput,
    manager?: EntityManager,
  ): Promise<void> {
    const isCompleted = input.status === TripStopStatus.COMPLETED;
    await this.em(manager).query(
      `INSERT INTO "trip_stop" ("tripCode", "hubId", "stopSequence", "stopType", "status", "processedAt", "processedByUserId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       ON CONFLICT ("tripCode", "hubId") DO UPDATE SET
         "status" = CASE WHEN "trip_stop"."status" = 'COMPLETED' THEN 'COMPLETED' ELSE EXCLUDED."status" END,
         "processedAt" = COALESCE("trip_stop"."processedAt", EXCLUDED."processedAt"),
         "processedByUserId" = COALESCE("trip_stop"."processedByUserId", EXCLUDED."processedByUserId"),
         "deletedAt" = NULL,
         "updatedAt" = NOW()`,
      [
        input.tripCode,
        input.hubId,
        input.stopSequence ?? 1,
        input.stopType ?? TripStopType.TRANSIT,
        input.status,
        isCompleted ? new Date() : null,
        isCompleted ? (input.userId ?? null) : null,
      ],
    );
  }

  /**
   * Stock of an order at a hub from the invoice ledger:
   * SUM(INBOUND) - SUM(OUTBOUND + TRANSFER). Returns null when the hub has no ledger rows.
   */
  async getHubStock(
    orderId: number,
    hubId: number,
    manager?: EntityManager,
  ): Promise<number | null> {
    const rows = await this.em(manager).query(
      `SELECT COUNT(*)::int AS "cnt",
              COALESCE(SUM(CASE WHEN "type" = 'INBOUND' THEN "quantity"
                                WHEN "type" IN ('OUTBOUND', 'TRANSFER') THEN -"quantity"
                                ELSE 0 END), 0)::int AS "stock"
       FROM "order_inventory_transaction"
       WHERE "orderId" = $1 AND "hubId" = $2 AND "deletedAt" IS NULL`,
      [orderId, hubId],
    );
    if (!rows?.[0] || Number(rows[0].cnt) === 0) return null;
    return Number(rows[0].stock);
  }

  /**
   * Quantity of an order still on a logical trip (loaded by TRANSFER invoices minus
   * quantities already received by INBOUND invoices referencing the same trip).
   */
  async getInTransitQuantity(
    orderId: number,
    tripCode: string,
    manager?: EntityManager,
  ): Promise<{ loaded: number; received: number; inTransit: number }> {
    const rows = await this.em(manager).query(
      `SELECT
         COALESCE(SUM(CASE WHEN "type" = 'TRANSFER' THEN "quantity" ELSE 0 END), 0)::int AS "loaded",
         COALESCE(SUM(CASE WHEN "type" = 'INBOUND' THEN "quantity" ELSE 0 END), 0)::int AS "received"
       FROM "order_inventory_transaction"
       WHERE "orderId" = $1 AND "tripCode" = $2 AND "deletedAt" IS NULL`,
      [orderId, tripCode],
    );
    const loaded = Number(rows?.[0]?.loaded) || 0;
    const received = Number(rows?.[0]?.received) || 0;
    return { loaded, received, inTransit: Math.max(0, loaded - received) };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // SQL fragments (TypeORM query builder, main alias `order`, param `:userHubId`)
  // ───────────────────────────────────────────────────────────────────────────

  /** Ledger stock of `order` at the viewer hub. */
  hubStockSql(): string {
    return `COALESCE((SELECT SUM(CASE WHEN hstx."type" = 'INBOUND' THEN hstx."quantity" WHEN hstx."type" IN ('OUTBOUND', 'TRANSFER') THEN -hstx."quantity" ELSE 0 END) FROM "order_inventory_transaction" hstx WHERE hstx."orderId" = order.id AND hstx."hubId" = :userHubId AND hstx."deletedAt" IS NULL), 0)`;
  }

  /**
   * Goods of `order` are on a trip whose stop at the viewer hub is still PENDING and the
   * order is meant to be unloaded there (its final hub is the viewer hub, has no hub, or
   * the trip does not stop at its final hub).
   */
  pendingInboundSql(): string {
    return `EXISTS (SELECT 1 FROM "trip_stop" pits WHERE pits."tripCode" = order.currentTripCode AND pits."hubId" = :userHubId AND pits."status" = 'PENDING' AND pits."deletedAt" IS NULL AND (order.destinationHubId = :userHubId OR order.destinationHubId IS NULL OR NOT EXISTS (SELECT 1 FROM "trip_stop" pits2 WHERE pits2."tripCode" = pits."tripCode" AND pits2."hubId" = order.destinationHubId AND pits2."deletedAt" IS NULL)))`;
  }

  /** The viewer hub already issued an outbound/transfer invoice for `order`. */
  hubDispatchedSql(): string {
    return `EXISTS (SELECT 1 FROM "order_inventory_transaction" hdtx WHERE hdtx."orderId" = order.id AND hdtx."hubId" = :userHubId AND hdtx."type" IN ('OUTBOUND', 'TRANSFER') AND hdtx."deletedAt" IS NULL)`;
  }

  /**
   * Context-aware (hub-scoped) order status:
   *  - DRAFT              : still a draft at this hub
   *  - INBOUND (Lưu kho)  : this hub holds stock
   *  - PENDING_INBOUND    : on a trip heading to this hub, not yet received (Chờ nhập kho)
   *  - COMPLETED_INBOUND  : this hub dispatched everything it held (Đã xuất kho)
   *  - otherwise          : the global order status
   */
  hubStatusSql(): string {
    const draftList = DRAFT_LIKE_STATUSES.map((s) => `'${s}'`).join(', ');
    return `(CASE
      WHEN order.status IN (${draftList}) AND COALESCE(order.currentHubId, order.originHubId) = :userHubId THEN 'DRAFT'
      WHEN ${this.hubStockSql()} > 0 THEN 'INBOUND'
      WHEN ${this.pendingInboundSql()} THEN 'PENDING_INBOUND'
      WHEN ${this.hubDispatchedSql()} THEN 'COMPLETED_INBOUND'
      ELSE order.status END)`;
  }

  /** Visibility scope of a WAREHOUSE_MANAGER over orders. */
  hubScopeSql(): string {
    return `(order.originHubId = :userHubId OR order.destinationHubId = :userHubId OR order.originHubId IS NULL OR order.currentHubId = :userHubId OR EXISTS (SELECT 1 FROM "order_inventory_transaction" sctx WHERE sctx."orderId" = order.id AND sctx."hubId" = :userHubId AND sctx."deletedAt" IS NULL) OR EXISTS (SELECT 1 FROM "trip_stop" scts WHERE scts."tripCode" = order.currentTripCode AND scts."hubId" = :userHubId AND scts."deletedAt" IS NULL))`;
  }
}
