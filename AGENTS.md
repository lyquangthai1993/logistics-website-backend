# BACKEND AI AGENT INSTRUCTIONS (NestJS TMS)

## 1. ARCHITECTURE PATTERN
- Clean Architecture / Modular Monolith:
  - `src/modules/{auth, users, orders, trips, fleet, warehouse, billing, notifications}`
  - Mỗi module gồm: `*.controller.ts`, `*.service.ts`, `*.dto.ts`, `entities/`, `*.repository.ts`.
- Database: PostgreSQL with Prisma ORM.
- Event Bus: `@nestjs/event-emitter` cho in-app events hoặc `Redis/BullMQ` cho async job.

## 2. AUTHENTICATION & SECURITY RULES
- TUYỆT ĐỐI KHÔNG dùng Clerk / 3rd-party auth ngoài. Dùng Native JWT:
  - `POST /api/v1/auth/login`: Trả về `{ access_token, refresh_token, user: { id, name, role, warehouseId } }`.
  - Guards: `JwtAuthGuard`, `RolesGuard` (`@Roles('SUPER_ADMIN', 'DISPATCHER', ...)`).
  - Password hashing: `bcrypt` hoặc `argon2`.

## 3. CORE BUSINESS MODULES & SPECS
### Module: Orders (`/orders`)
- Fields: `orderCode` (Unique), `senderInfo`, `receiverInfo`, `pickupAddress`, `deliveryAddress`, `warehouseId` (Kho tiếp nhận), `totalWeight`, `totalCbm`, `status` (`PENDING`, `DISPATCHED`, `IN_WAREHOUSE`, `SHIPPING`, `DELIVERED`, `CANCELLED`).
- Trigger: Khi Order tạo thành công -> emit `order.created` -> bắn notification sang Fleet & Warehouse.

### Module: Trips / Dispatch (`/trips`)
- Quản lý gom đơn: 1 Trip chứa nhiều Orders.
- Validate: `SUM(orders.weight) <= vehicle.maxWeight` và `SUM(orders.cbm) <= vehicle.maxCbm`.
- Tính giá theo chuyến: `tripPrice`, phụ phí bốc dỡ, cầu đường.
- Status: `DRAFT` -> `ASSIGNED` -> `LOADING` -> `DEPARTED` -> `COMPLETED`.

### Module: Warehouse (`/warehouse`)
- Quản lý Inbound (Check-in hàng về kho Andromeda, Magellan, ...) và Outbound (Xác nhận xuất hàng lên xe).
- Quản lý sức chứa kho ($m^3$, Tấn).

### Module: Fleet (`/fleet`)
- Quản lý Đầu xe (`plateNumber`, tải trọng Kg, thể tích $m^3$, loại thùng), Rơ-moóc, Tài xế (`driverName`, SĐT, GPLX).

## 4. CODING CONVENTIONS
- DTO Validation: `class-validator`, `class-transformer`. Luôn validate strictly (`whitelist: true, forbidNonWhitelisted: true`).
- Standard API Response: `{ success: boolean, statusCode: number, data: T, message?: string, meta?: PaginationMeta }`.
- Error Handling: Global `HttpExceptionFilter`.