import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Task 41 (Feedback 13/10): Data Healing Migration
 * Restores original Master Contract destination (destinationHub, destinationHubId)
 * for historical orders that were accidentally overwritten by outbound transfer / xe bo / local customer delivery.
 */
export class RestoreMasterContractDestination1789060000000
  implements MigrationInterface
{
  name = 'RestoreMasterContractDestination1789060000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Restore destination from earliest INBOUND inventory transaction
    await queryRunner.query(`
      UPDATE "order" o
      SET "destinationHub" = sub.inbound_dest,
          "destinationHubId" = (
            SELECT h.id FROM "hub" h
            WHERE h.name = sub.inbound_dest AND h."deletedAt" IS NULL
            LIMIT 1
          )
      FROM (
        SELECT DISTINCT ON ("orderId") "orderId", destination AS inbound_dest
        FROM "order_inventory_transaction"
        WHERE type = 'INBOUND'
          AND destination IS NOT NULL
          AND destination != ''
          AND destination NOT ILIKE 'Xe bo%'
        ORDER BY "orderId", id ASC
      ) sub
      WHERE o.id = sub."orderId"
        AND (
          o."destinationHub" ILIKE 'Xe bo%'
          OR o."destinationHub" IS NULL
          OR EXISTS (
            SELECT 1 FROM "order_inventory_transaction" out_tx
            WHERE out_tx."orderId" = o.id
              AND out_tx.type IN ('OUTBOUND', 'TRANSFER')
              AND out_tx.destination = o."destinationHub"
              AND out_tx.destination != sub.inbound_dest
          )
        );
    `);

    // 2. Restore destination from route contract where route is 'Origin -> Destination'
    await queryRunner.query(`
      UPDATE "order"
      SET "destinationHub" = TRIM(SPLIT_PART(route, '→', 2)),
          "destinationHubId" = (
            SELECT h.id FROM "hub" h
            WHERE h.name = TRIM(SPLIT_PART(route, '→', 2)) AND h."deletedAt" IS NULL
            LIMIT 1
          )
      WHERE route LIKE '%→%'
        AND TRIM(SPLIT_PART(route, '→', 2)) NOT ILIKE 'Xe bo%'
        AND ("destinationHub" ILIKE 'Xe bo%' OR "destinationHub" IS NULL);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Non-destructive data healing migration; no down operation required.
  }
}
