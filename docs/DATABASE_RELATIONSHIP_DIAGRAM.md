# Current database relationship diagram

**Source:** read-only PostgreSQL catalog query against `logistics_tms_core` on 2026-11-24 at 12:27 UTC, cross-checked with backend TypeORM entities and migrations. The database contains 21 application tables plus TypeORM's `migrations` table, and 18 foreign key constraints. Its latest recorded migration is `RepairSerialSequences1789180000000`.

The 21 application tables are split into three diagrams for readability. `FK` marks a foreign key confirmed in the database catalog. Nullable foreign keys are marked `FK nullable`. Columns without an `FK` mark are **not** database-enforced relationships, even when their names look like IDs.

## Orders, trips, and warehouse ledger

```mermaid
erDiagram
    HUB {
        int id PK
        string code UK
        string name
        int level
        string region
    }
    ORDER {
        int id PK
        string orderCode "not unique; multiple inbound rows"
        string status
        int originHubId FK "nullable"
        int destinationHubId FK "nullable"
        int currentHubId FK "nullable"
        int totalQuantity
        int remainingQuantity
        string currentTripCode "logical reference"
    }
    TRIP {
        int id PK
        int orderId FK
        string tripCode "logical group key"
        int originHubId FK "nullable"
        int destinationHubId FK "nullable"
        int quantityAllocated "nullable"
        string status
        string type
    }
    TRIP_STOP {
        int id PK
        string tripCode "logical reference"
        int hubId FK
        int stopSequence
        string status
        int processedByUserId "no FK"
    }
    ORDER_INVENTORY_TRANSACTION {
        int id PK
        int orderId FK
        int hubId FK "nullable"
        int tripId "no FK"
        string tripCode "logical reference"
        string type
        int quantity
        int remainingQuantity
    }
    ORDER_ACTIVITY_LOG {
        int id PK
        int orderId "no database FK"
        string orderCode "historical code"
        int actorUserId "no FK"
        int hubId "no FK"
        string tripCode "logical reference"
        string action
    }
    HUB o|--o{ ORDER : originHubId
    HUB o|--o{ ORDER : destinationHubId
    HUB o|--o{ ORDER : currentHubId
    ORDER ||--o{ TRIP : orderId
    HUB o|--o{ TRIP : originHubId
    HUB o|--o{ TRIP : destinationHubId
    HUB ||--o{ TRIP_STOP : hubId
    ORDER ||--o{ ORDER_INVENTORY_TRANSACTION : orderId
    HUB o|--o{ ORDER_INVENTORY_TRANSACTION : hubId
```

`trip` is one allocation row per order on a logical trip. Rows with the same `tripCode` form a trip; `trip_stop.tripCode`, `order.currentTripCode`, and ledger `tripCode` refer to that group without a foreign key. `order.orderCode` is deliberately non-unique so separate inbound records can share one waybill. The warehouse ledger is `order_inventory_transaction`; its `tripId` has no foreign key. `order_activity_log.orderId` has a TypeORM relation, but the database contains only an index, not a foreign key constraint.

## Accounts and fleet

```mermaid
erDiagram
    ROLE {
        int id PK
        string name
        string role_code UK
    }
    STATUS {
        int id PK
        string name
    }
    FILE {
        uuid id PK
        string path
    }
    HUB {
        int id PK
        string code UK
        string name
    }
    USER {
        int id PK
        uuid photoId FK "nullable; unique"
        int roleId FK "nullable"
        int statusId FK "nullable"
        int hubId FK "nullable"
        string username
        string email
    }
    SESSION {
        int id PK
        int userId FK "nullable"
        string hash
    }
    VEHICLE {
        int id PK
        int hubId FK "nullable"
        int assignedDriverId "no FK"
        string licensePlate UK
        string status
    }
    DRIVER {
        int id PK
        string fullName
        string phone
        string status
    }
    NOTIFICATION {
        int id PK
        int userId "no FK"
        string type
        boolean isRead
    }
    FILE o|--o| USER : photoId
    ROLE o|--o{ USER : roleId
    STATUS o|--o{ USER : statusId
    HUB o|--o{ USER : hubId
    USER o|--o{ SESSION : userId
    HUB o|--o{ VEHICLE : hubId
```

`vehicle.assignedDriverId` and `notification.userId` are stored identifiers without declared foreign keys. `trip` stores `licensePlate` and `driverName` as text; the old direct vehicle and driver relations were removed by migrations.

## Reports and independent reference tables

```mermaid
erDiagram
    HUB {
        int id PK
        string code UK
    }
    DAILY_HUB_OPERATIONAL_REPORT {
        int id PK
        int hubId FK
        string reportDate
        timestamp calculatedAt
    }
    DAILY_REGIONAL_DISPATCH_REPORT {
        int id PK
        int hubId FK
        string reportDate
        string region
        timestamp calculatedAt
    }
    WAREHOUSE_HUB_ORDER_SUMMARY {
        int id PK
        int hubId FK
        string status
        int orderCount
        timestamp calculatedAt
    }
    ORDER_CODE_COUNTER {
        int id PK
        int hubId "no FK"
        string operatorInitials
        string yearMonth
        int lastSequence
    }
    CRON_JOB_CONFIG {
        int id PK
        string jobKey
    }
    CRON_JOB_EXECUTION_LOG {
        int id PK
        string jobKey "logical reference"
        int actorUserId "no FK"
        string status
    }
    PROVINCE_REFERENCE {
        int id PK
        string name
        string region
    }
    HUB ||--o{ DAILY_HUB_OPERATIONAL_REPORT : hubId
    HUB ||--o{ DAILY_REGIONAL_DISPATCH_REPORT : hubId
    HUB ||--o{ WAREHOUSE_HUB_ORDER_SUMMARY : hubId
```

The three report tables are persisted snapshots keyed by hub and reporting date/status, not live joins to `order` or `trip`. `order_code_counter.hubId`, cron `jobKey`, and `order.province` are logical references without foreign keys to `hub`, `cron_job_config`, or `province_reference`, respectively.

## Verification

- Relationship lines match all 18 foreign key rows returned by `information_schema.table_constraints`, `key_column_usage`, and `constraint_column_usage` in the current database.
- The table list matches the live catalog: 21 application tables and `migrations` (bookkeeping, omitted from the diagrams). Apparent IDs without a catalog constraint are labeled `no FK`, including the divergent `order_activity_log.orderId` mapping.
