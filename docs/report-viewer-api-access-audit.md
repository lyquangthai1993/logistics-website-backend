# REPORT_VIEWER API Access Audit

Generated from backend NestJS controller decorators on 2026-11-18. This is a static source audit; live token probes were unavailable because the local backend cannot resolve the configured Railway database hostname.

## Summary

- Total controller routes inventoried: 111
- Report and report-filter endpoints explicitly allowed: 6
- Non-report business routes blocked by RolesGuard: 91
- Authentication/session exceptions: 3
- Public authentication flows: 9
- Routes needing separate guard review: 0
- Public infrastructure endpoints: 2

`REPORT_VIEWER` is authorized only for report GET routes and the read-only hub lookups used by report filters. Writes and other non-report business APIs are denied. Login, own identity read, token refresh, logout, public auth/recovery, and health/app-info endpoints are listed separately because they do not grant business data access.

## Full endpoint inventory

| Method | Endpoint | Source | Access for REPORT_VIEWER | Basis |
|---|---|---|---|---|
| POST | `/api/v1/auth/apple/login` | `src/auth-apple/auth-apple.controller.ts` | PUBLIC AUTH FLOW | Apple login endpoint; not report data |
| POST | `/api/v1/auth/facebook/login` | `src/auth-facebook/auth-facebook.controller.ts` | PUBLIC AUTH FLOW | Facebook login endpoint; not report data |
| POST | `/api/v1/auth/google/login` | `src/auth-google/auth-google.controller.ts` | PUBLIC AUTH FLOW | Google login endpoint; not report data |
| POST | `/api/v1/auth/email/confirm` | `src/auth/auth.controller.ts` | PUBLIC AUTH FLOW | Authentication/recovery endpoint; not report data |
| POST | `/api/v1/auth/email/confirm/new` | `src/auth/auth.controller.ts` | PUBLIC AUTH FLOW | Authentication/recovery endpoint; not report data |
| POST | `/api/v1/auth/email/login` | `src/auth/auth.controller.ts` | PUBLIC AUTH FLOW | Authentication/recovery endpoint; not report data |
| POST | `/api/v1/auth/email/register` | `src/auth/auth.controller.ts` | PUBLIC AUTH FLOW | Authentication/recovery endpoint; not report data |
| POST | `/api/v1/auth/forgot/password` | `src/auth/auth.controller.ts` | PUBLIC AUTH FLOW | Authentication/recovery endpoint; not report data |
| POST | `/api/v1/auth/login-as` | `src/auth/auth.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| POST | `/api/v1/auth/login-as/:userId` | `src/auth/auth.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| POST | `/api/v1/auth/logout` | `src/auth/auth.controller.ts` | AUTH EXCEPTION | Session logout only; JWT required |
| DELETE | `/api/v1/auth/me` | `src/auth/auth.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/auth/me` | `src/auth/auth.controller.ts` | AUTH EXCEPTION | Own identity only; JWT required |
| PATCH | `/api/v1/auth/me` | `src/auth/auth.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| POST | `/api/v1/auth/refresh` | `src/auth/auth.controller.ts` | AUTH EXCEPTION | Session refresh only; refresh JWT/cookie required |
| POST | `/api/v1/auth/reset/password` | `src/auth/auth.controller.ts` | PUBLIC AUTH FLOW | Authentication/recovery endpoint; not report data |
| GET | `/api/v1/drivers` | `src/drivers/drivers.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| POST | `/api/v1/drivers` | `src/drivers/drivers.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| DELETE | `/api/v1/drivers/:id` | `src/drivers/drivers.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/drivers/:id` | `src/drivers/drivers.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| PATCH | `/api/v1/drivers/:id` | `src/drivers/drivers.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/files/:path` | `src/files/infrastructure/uploader/local/files.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER; role omitted from route allow-list |
| POST | `/api/v1/files/upload` | `src/files/infrastructure/uploader/local/files.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| POST | `/api/v1/files/upload` | `src/files/infrastructure/uploader/s3-presigned/files.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| POST | `/api/v1/files/upload` | `src/files/infrastructure/uploader/s3/files.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/` | `src/home/home.controller.ts` | PUBLIC | No report-role guard |
| GET | `/api/v1/health` | `src/home/home.controller.ts` | PUBLIC | No report-role guard |
| GET | `/api/v1/hubs` | `src/hubs/hubs.controller.ts` | ALLOWED (REPORT FILTER) | Read-only lookup used to filter reports |
| POST | `/api/v1/hubs` | `src/hubs/hubs.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| DELETE | `/api/v1/hubs/:id` | `src/hubs/hubs.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/hubs/:id` | `src/hubs/hubs.controller.ts` | ALLOWED (REPORT FILTER) | Read-only lookup used to filter reports |
| PATCH | `/api/v1/hubs/:id` | `src/hubs/hubs.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| PATCH | `/api/v1/hubs/:id/toggle-active` | `src/hubs/hubs.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/hubs/active` | `src/hubs/hubs.controller.ts` | ALLOWED (REPORT FILTER) | Read-only lookup used to filter reports |
| POST | `/api/v1/mail/queue-clean` | `src/mail/mail.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/mail/queue-status` | `src/mail/mail.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| POST | `/api/v1/mail/test-send` | `src/mail/mail.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/notifications` | `src/notifications/notifications.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| POST | `/api/v1/notifications` | `src/notifications/notifications.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| PATCH | `/api/v1/notifications/:id/read` | `src/notifications/notifications.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| PATCH | `/api/v1/notifications/read-all` | `src/notifications/notifications.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| POST | `/api/v1/notifications/send-test` | `src/notifications/notifications.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/notifications/stats` | `src/notifications/notifications.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/notifications/unread-count` | `src/notifications/notifications.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/admin/reports/cronjobs` | `src/orders/admin-reports.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| PATCH | `/api/v1/admin/reports/cronjobs/config` | `src/orders/admin-reports.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| POST | `/api/v1/admin/reports/cronjobs/rerun` | `src/orders/admin-reports.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/admin/reports/operational` | `src/orders/admin-reports.controller.ts` | ALLOWED | Explicit REPORT_VIEWER report GET |
| GET | `/api/v1/admin/reports/operational/daily-trips` | `src/orders/admin-reports.controller.ts` | ALLOWED | Explicit REPORT_VIEWER report GET |
| POST | `/api/v1/admin/reports/operational/sync` | `src/orders/admin-reports.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/admin/reports/regional-dispatch` | `src/orders/admin-reports.controller.ts` | ALLOWED | Explicit REPORT_VIEWER report GET |
| POST | `/api/v1/admin/reports/regional-dispatch/sync` | `src/orders/admin-reports.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/orders` | `src/orders/orders.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| POST | `/api/v1/orders` | `src/orders/orders.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| DELETE | `/api/v1/orders/:id` | `src/orders/orders.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/orders/:id` | `src/orders/orders.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| PATCH | `/api/v1/orders/:id` | `src/orders/orders.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| PATCH | `/api/v1/orders/:id/admin-override` | `src/orders/orders.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/orders/:id/ledger` | `src/orders/orders.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| PATCH | `/api/v1/orders/:id/no-vehicle` | `src/orders/orders.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| PATCH | `/api/v1/orders/:id/submit` | `src/orders/orders.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/orders/check-code` | `src/orders/orders.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/orders/code/:orderCode/activity-logs` | `src/orders/orders.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| POST | `/api/v1/orders/code/:orderCode/reconcile` | `src/orders/orders.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/orders/generate-code` | `src/orders/orders.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| POST | `/api/v1/orders/refresh-metrics` | `src/orders/orders.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/orders/stats` | `src/orders/orders.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/warehouse/inbound-trips` | `src/orders/warehouse.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| POST | `/api/v1/warehouse/inbound/batch-create` | `src/orders/warehouse.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| POST | `/api/v1/warehouse/inbound/confirm` | `src/orders/warehouse.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| DELETE | `/api/v1/warehouse/inbound/drafts/:tripCode` | `src/orders/warehouse.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| POST | `/api/v1/warehouse/inbound/quick-create` | `src/orders/warehouse.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/warehouse/inbound/receipt-data` | `src/orders/warehouse.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/warehouse/kpi` | `src/orders/warehouse.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/warehouse/orders` | `src/orders/warehouse.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/warehouse/orders/:orderCode/transactions` | `src/orders/warehouse.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/warehouse/outbound-trips` | `src/orders/warehouse.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| POST | `/api/v1/warehouse/outbound/confirm` | `src/orders/warehouse.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| POST | `/api/v1/warehouse/outbound/draft` | `src/orders/warehouse.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| DELETE | `/api/v1/warehouse/outbound/drafts/:tripCode` | `src/orders/warehouse.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| DELETE | `/api/v1/warehouse/transactions/:id` | `src/orders/warehouse.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| PATCH | `/api/v1/warehouse/transactions/:id` | `src/orders/warehouse.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| PATCH | `/api/v1/warehouse/transactions/:id/quantity` | `src/orders/warehouse.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| POST | `/api/v1/warehouse/transactions/:id/restore` | `src/orders/warehouse.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| POST | `/api/v1/warehouse/trips/:tripCode/append-order` | `src/orders/warehouse.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| POST | `/api/v1/warehouse/trips/:tripCode/append-stored-orders` | `src/orders/warehouse.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/warehouse/trips/:tripCode/available-outbound-orders` | `src/orders/warehouse.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/warehouse/trips/:tripCode/history` | `src/orders/warehouse.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/warehouse/trips/:tripCode/manifest` | `src/orders/warehouse.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| PATCH | `/api/v1/warehouse/trips/:tripCode/orders/:orderId/destination` | `src/orders/warehouse.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| POST | `/api/v1/warehouse/trips/:tripCode/rollback` | `src/orders/warehouse.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| POST | `/api/v1/warehouse/trips/:tripCode/transit-step` | `src/orders/warehouse.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/province-references` | `src/provinces/province-reference.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/trips` | `src/trips/trips.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| POST | `/api/v1/trips` | `src/trips/trips.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| DELETE | `/api/v1/trips/:id` | `src/trips/trips.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/trips/:id` | `src/trips/trips.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| PATCH | `/api/v1/trips/:id` | `src/trips/trips.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| PATCH | `/api/v1/trips/:id/confirm` | `src/trips/trips.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| POST | `/api/v1/trips/split` | `src/trips/trips.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/trips/stats` | `src/trips/trips.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/users` | `src/users/users.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| POST | `/api/v1/users` | `src/users/users.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| DELETE | `/api/v1/users/:id` | `src/users/users.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/users/:id` | `src/users/users.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| PATCH | `/api/v1/users/:id` | `src/users/users.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/vehicles` | `src/vehicles/vehicles.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| POST | `/api/v1/vehicles` | `src/vehicles/vehicles.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| DELETE | `/api/v1/vehicles/:id` | `src/vehicles/vehicles.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| GET | `/api/v1/vehicles/:id` | `src/vehicles/vehicles.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
| PATCH | `/api/v1/vehicles/:id` | `src/vehicles/vehicles.controller.ts` | BLOCKED | RolesGuard denies REPORT_VIEWER by explicit allow-list or default-deny |
