# Order Ledger / Counter Audit — 2026-11-13

## Scope

Production snapshot: `backups/prod_backup_20261113_091427.json` (local, not committed).

The first-pass audit identified orders where the persisted `order.inboundQuantity` counter is lower than the persisted outbound counter. This is a data-integrity warning, not proof that every order was physically over-dispatched. The operational ledger must be checked before correcting any order.

## Identified order codes

| Order code | `order.inboundQuantity` | `order.outboundQuantity` | Counter delta |
|---|---:|---:|---:|
| `HVP2610-283.2` | 16 | 63 | +47 |
| `NMT2611-0093` | 250 | 300 | +50 |
| `NMT2610-340` | 434 | 868 | +434 |
| `NAV2611-0001` | 24 | 31 | +7 |
| `NTC2611-160` | 306 | 327 | +21 |
| `NMT2611-0016.E` | 14 | 100 | +86 |
| `NKT2611-012` | 170 | 217 | +47 |
| `NMT2611-0079.H` | 102 | 211 | +109 |
| `NMT2611-0079.A` | 102 | 211 | +109 |
| `HQA2611-0048.B` | 16 | 204 | +188 |
| `NMT2611-0079.D` | 76 | 208 | +132 |
| `NMT2611-0079.K` | 76 | 208 | +132 |
| `NDA2611-0039` | 2 | 36 | +34 |

**Total:** 13 order codes, including `NTC2611-160`.

## Confirmed case: `NTC2611-160`

- Active inbound ledger: `327` packages.
- Active outbound ledger: `327` packages.
- Ledger balance: `0` packages.
- Physical warehouse confirmation: all `327` packages were dispatched.
- Finding: the order summary counters were stale (`306`), while the ledger was correct.

## Remediation status

- Inventory mutations now lock the related order row with `FOR UPDATE` before reading stock.
- Outbound paths use the operational ledger as the stock source.
- Historical counters have **not** been modified by this change.
- Before any production data correction, reconcile each code against active ledger rows, deleted transaction history, transfer movements, and audit logs.

## Verification evidence

- Targeted backend tests: `14/14` passed.
- Backend build: passed.
- Targeted ESLint: passed.
- Full backend suite: `53` passed, `1` unrelated pre-existing hubs mock failure (`addOrderBy`).
