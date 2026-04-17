# Booking App

## Backend

Written in golang. Uses SQLite for persistent booking storage via `github.com/mattn/go-sqlite3`.

Endpoints:
- `GET /api/config` - public GPU resource configuration (includes `bookingWindowDays`)
- `GET /api/bookings` - list all bookings (includes `source` field, `activeReservations`, and `currentUser`)
- `POST /api/bookings` - create a single booking (user identity from `X-Forwarded-User` header)
- `POST /api/bookings/bulk` - create bookings across multiple resources, dates, and hours in one request. Auto-finds available slot indices, evicts consumed bookings, skips reserved ones. Accepts `resources` (map of resource type to count), `startDate`, `endDate`, `description`, `startHour`, `endHour` (UTC).
- `DELETE /api/bookings?id=<id>` - cancel a booking (owner or admin only; consumed bookings cannot be cancelled by normal users, returns `403 consumed_booking`)
- `POST /api/admin/login` - authenticate with admin password, returns HMAC-signed token
- `GET /api/admin` - admin data, requires `Authorization: Bearer <token>` (all bookings + config)
- `DELETE /api/admin?id=<id>` - admin delete any booking, requires Bearer token
- `DELETE /api/admin` (no id) - admin delete all bookings, requires Bearer token
- `POST /api/admin/reservations` - toggle reservation sync on/off at runtime, requires Bearer token
- `GET /api/admin/database/export` - download the SQLite database file (flushes WAL first), requires Bearer token
- `POST /api/admin/database/import` - upload and replace the SQLite database (multipart form, `database` field, 100MB limit), requires Bearer token

The database path defaults to `./bookings.db` locally, overridden by `DB_PATH` env var (set to `/data/bookings.db` in the container via helm chart, backed by a PVC).

### Configuration env vars

- `PORT` - server port (default `8080`)
- `DB_PATH` - SQLite database path (default `./bookings.db`)
- `ADMIN_PASSWORD` - admin login password (default `admin` for local dev)
- `BOOKING_WINDOW_DAYS` - how far ahead users can book (default `30`)
- `KUEUE_SYNC_ENABLED` - enable LocalQueue watcher (default `true`)
- `KUEUE_SYNC_INTERVAL` - poll interval in seconds (default `60`)
- `KUEUE_BOOKING_DAYS` - days to book ahead when resource is in use (default `0` = rest of current week)
- `DEV_USER` - override user identity for local development (bypasses `X-Forwarded-User` header)

### Booking conflict rules

Server enforces uniqueness per resource + unit + date (only `"full"` slot type exists — AM/PM slots have been removed):
- The SQLite schema has a UNIQUE constraint on `(resource, slot_index, date, slot_type)` to prevent exact duplicates
- Bookings have a `source` column: `"reserved"` (user-created) or `"consumed"` (auto-synced from LocalQueue usage)
- **Reserved bookings take priority over consumed bookings**: if a user reserves a slot occupied by a consumed booking, the consumed booking is automatically evicted and the reserved booking proceeds. Only reserved-to-reserved conflicts return `slot_taken`. This reduces the unreserved Cohort and triggers Kueue workload preemption.

## Frontend

Written in Next.js 15 + Tailwind CSS 3.4, using the Red Hat brand theme (Red Hat Display/Text fonts, rh-red/rh-gray color palette).

Use OpenShift OAuth proxy container for logging into the application. The user is then able to make booking reservations for GPU resources.

API calls to the backend are always Next.js server actions so as not to expose an API in public. Only the api/config is exposed (for public backend settings).

**Backend dates are UTC.** The backend computes reservation `until` timestamps in UTC. Reservation expiry is at midnight (00:00 UTC next day). **The frontend uses the browser's local timezone** (`getFullYear`, `getMonth`, `getDate`, etc.) for all date logic — today detection, booking window, weekend checks, calendar rendering, and the live clock. Dates are exchanged with the backend as YYYY-MM-DD strings.

### Main booking page

The booking reservation system for GPU resources with:
- **Month/year calendar** - full mini calendar grid (Sun-Sat) with month/year navigation, TODAY badge, GPU equivalent usage badges per day, greyed-out dates outside the booking window. Click a day to select it for the grid below. Ctrl+click to multi-select dates, Shift+click for date ranges. Right-click a date to open the "Book GPU" context menu. "Back to today" link when viewing other months. Past dates with historical bookings are clickable and navigable.
- **GPU Usage Overview panel** (`GpuUsagePanel.tsx`) - shows per-resource horizontal stacked bars (consumed vs reserved vs free) for the selected date, with per-unit dot breakdown and hover tooltips.
- **GPU resource selector** - 4 resource type cards in the header, supports Ctrl+click multi-select (at least one must remain selected). When multiple resources are selected, one booking grid table is rendered per resource type.
- **Booking grid** - date group header rows separating each day, single row per date, columns per GPU unit with Reserve buttons for available slots, user names for booked slots. Bookings with non-full-day hours show `HH:00—HH:00 UTC` labels. Consumed bookings show `⚡ consumed` label with an amber **Override** button — reserved bookings take priority over consumed bookings and will evict them. Reserved bookings with active K8s reservations show `🐍 user-{username}` indicator. Hover over a reserved booking to reveal **Edit** and **Cancel** buttons. Past dates show as read-only with HISTORY badge.
- **Booking modal** - opened via right-click context menu ("Book GPU") or the Edit button on an existing booking. Supports: resource +/- selectors for each GPU/MIG type, date range, start/end hour selectors in local timezone (converted to UTC for storage), 160-character description field, GPU equivalent total display. Edit mode pre-fills from the existing booking and performs cancel+recreate on submit.
- **My Bookings button** - toggles in the header. When active (highlighted red), selects all dates with the current user's reserved bookings and navigates to the earliest month. Click again to deselect and return to today.
- **Booking window** - configurable from `/api/config` (default 30 days), navigation limited to bookable months plus historical months with existing bookings
- **Historical view** - users can navigate back to past months that have bookings; past dates are read-only (no Reserve/Cancel buttons).
- **Clock** - live datetime displayed in the header in the browser's local timezone, updates every second

### Admin pages

- `/admin/login` - password login form (posts to `/api/admin/login`, stores token as httpOnly cookie)
- `/admin` - protected by middleware (redirects to login if no cookie), shows:
  - **UTC clock** - live UTC datetime in the header
  - Summary tiles per GPU resource type with booking counts (click to filter)
  - **Source filter** buttons (All / Reserved / Consumed) with counts to filter bookings by source
  - **Reservation sync toggle** - green ON / red OFF button to enable/disable K8s reservation sync at runtime without redeploying
  - Bookings table with **sortable columns** (click header to sort asc/desc), **text filter** (search by user, date, resource, email, description, slot type), **Hours (UTC)** column, **Description** column, and **Source column**
  - **Delete button** per row with confirm/cancel inline (admin can delete any booking including consumed)
  - **Delete All** button with confirmation to clear all bookings (consumed bookings will be repopulated on next sync cycle)
  - **Database Export/Import** - Export button downloads the SQLite database file; Import button uploads a replacement database file (`.db`, `.sqlite`, `.sqlite3`) with confirmation dialog
  - Auto-refresh every 30 seconds
  - Logout button

People can book GPU slots for full days, multiple days, or specific hour ranges within a day. Hours are entered in local timezone in the booking modal and stored as UTC in the database.

### GPU's

The GPU is based on multiple H200 GPU's that have MIG enabled with the following flavours.

```yaml
          h200:
            cpu: 300
            memory: 3000Gi
            nvidia.com/gpu: 8
            nvidia.com/mig-3g.71gb: 8
            nvidia.com/mig-2g.35gb: 8
            nvidia.com/mig-1g.18gb: 16
```

Kueue is configured with the following ClusterQueue's

```bash
oc get clusterqueue -A

NAME                  COHORT       PENDING WORKLOADS
default                            0
unreserved            unreserved   0
unreserved-priority   unreserved   0
```

LocalQueue's are created for projects and are used for borrowing and preemption. We automatically add reservations based on actual user usage.

### Kueue LocalQueue sync

A background process (`server/kueue.go`) polls all LocalQueues in the cluster and automatically creates/removes bookings based on GPU usage:

- Lists all LocalQueues via `kueue.x-k8s.io/v1beta1` API
- For queues with `reservingWorkloads > 0` or `admittedWorkloads > 0`, reads `flavorUsage` to determine GPU resource counts
- Aggregates resource counts per namespace across multiple LocalQueues (e.g. `default`, `unreserved`, `unreserved-priority` in same namespace are summed)
- Assigns globally unique slot indices per resource across namespaces to avoid UNIQUE constraint collisions (e.g. ns1 gets slots 0,1 and ns2 gets slots 2,3,4)
- Resolves the namespace `.metadata.labels["rhai-tmm.dev/owner"]` label as the booking owner (falls back to namespace name)
- Creates `full` day bookings for each GPU resource type in use
- Books from today through the rest of the week (or `KUEUE_BOOKING_DAYS` days ahead); on Sunday books through next Sunday
- Auto-bookings have `source: "consumed"` (vs `"reserved"` for user bookings) and deterministic IDs (`kueue-{namespace}-{resource}-s{slot}-{date}`)
- Each sync cycle reconciles: adds missing bookings, removes stale future bookings, skips slots already reserved
- Historical bookings (past dates) are preserved and not removed during reconciliation
- Consumed bookings cannot be cancelled by normal users (only admin or by removing the workload)
- Requires ClusterRole RBAC for reading `localqueues` and `namespaces` (created by helm chart when enabled)

```bash
# get namespace owner
oc get namespace my-namespace -o jsonpath='{.metadata.labels.rhai-tmm\.dev/owner}'

# get local queue usage
oc -n my-namespace get localqueue unreserved -o json | jq '[.status.reservingWorkloads], [.status.flavorUsage], [.status.flavorsReservation]'
```

### Handling Reservations

The reservation system manages GPU quota allocation using Kueue's Cohort, ClusterQueue, LocalQueue, and HardwareProfile resources. It is implemented in two places that must be kept in sync:

- **Helm chart**: `applications/rbac/templates/reservations.yaml` + `templates/kueue/_helpers.tpl`
- **Go runtime**: `applications/booking-app/server/reservations.go`

The Helm chart defines the declarative baseline (applied via ArgoCD), while the Go code performs the same operations at runtime when users make bookings through the booking app.

#### Architecture

All ClusterQueues share a single flat Cohort named `unreserved`. Preemption protection comes from the difference in `nominalQuota` between reserved (user) and unreserved CQs.

```
Cohort: unreserved (nominalQuota = total resources minus all user reservations)
  |
  +-- CQ: unreserved            nominalQuota: 0   (no preemption policy)
  +-- CQ: unreserved-priority   nominalQuota: 0   (borrowWithinCohort: LowerPriority, threshold 100)
  +-- CQ: user-<username>       nominalQuota: reserved amount (reclaimWithinCohort: Any)
```

#### How quota flows

1. `totalResources` in `applications/rbac/values.yaml` defines the full GPU pool (cpu, memory, GPU counts with per-unit `share` ratios for CPU/memory proportioning).
2. `reservations` in `values.yaml` (or `--set-json` overrides) maps users to GPU resource counts and an `until` expiry timestamp.
3. The `kueue.calculate-resources` helper iterates reservations, computes per-user CPU/memory from the `share` ratio, subtracts from the total, and returns per-user allocations plus a `remaining` key.
4. The `remaining` resources become the Cohort's `nominalQuota` — the shared pool all CQs borrow from.
5. Each user reservation becomes a ClusterQueue with `nominalQuota` set to their allocated amount.

#### Preemption model

The design ensures **user reservations are pre-eminent over unreserved workloads**:

| Policy | Mechanism |
|--------|-----------|
| **Unreserved CQs cannot preempt user workloads** | `unreserved` CQ has no preemption policy (all default to `Never`). `unreserved-priority` has `borrowWithinCohort: LowerPriority` with `maxPriorityThreshold: 100`, so it can only preempt workloads with priority <= 100. |
| **User CQs can preempt unreserved workloads** | `reclaimWithinCohort: Any` allows user CQs to preempt any workload that is borrowing from the Cohort. Since unreserved CQs have `nominalQuota: 0`, all their workloads are "borrowing" and therefore preemptible. |
| **User workloads within their reservation are protected** | Workloads within a CQ's `nominalQuota` are not "borrowing", so they are not targets for `reclaimWithinCohort` from other CQs. |
| **Beyond their reservation, users compete fairly** | `borrowWithinCohort: Never` on user CQs means they cannot preempt when borrowing beyond their reserved quota. They just use whatever is available. |

#### Per-user resources created

When a user has a reservation, the following K8s resources are created:

1. **ClusterQueue** `user-<username>` — joins `cohort: unreserved`, scoped to namespace `user-<username>`, with the preemption policies above plus `flavorFungibility`, `queueingStrategy: BestEffortFIFO`, `stopPolicy: None`. Labeled with `rhai-tmm.dev/until: <timestamp>` for expiry tracking.
2. **LocalQueue** `reserved` in namespace `user-<username>` — points to the user's ClusterQueue. Labeled with `rhai-tmm.dev/until`.
3. **HardwareProfile(s)** — one per GPU resource type reserved (e.g. `reserved-mig-35gb`), scoped to the user's namespace, referencing the `reserved` LocalQueue. Labeled with `rhai-tmm.dev/until`.

#### CPU/memory share calculation

Each GPU resource type has a `share` value in `totalResources` representing the fraction of total CPU/memory one unit consumes:

```yaml
nvidia.com/gpu:         { count: 8,  share: 0.0625 }    # 1 GPU = 6.25% of CPU/mem
nvidia.com/mig-3g.71gb: { count: 8,  share: 0.03125 }   # 1 MIG-71gb = 3.125%
nvidia.com/mig-2g.35gb: { count: 8,  share: 0.015625 }  # 1 MIG-35gb = 1.5625%
nvidia.com/mig-1g.18gb: { count: 16, share: 0.0078125 } # 1 MIG-18gb = 0.78125%
```

For a reservation of N units: `cpu = floor(N * share * totalCPU)`, `memory = floor(N * share * totalMemory)`.

#### Runtime sync (booking app)

The Go code in `server/reservations.go` vendors the same logic as the Helm chart:

- `syncReservations()` — queries today's bookings from SQLite, computes per-user quotas using the same share math, then applies ClusterQueue + LocalQueue + HardwareProfile(s) via server-side apply.
- `applyCohortRemaining()` — recomputes `totalResources - sum(reservations)` and applies the updated Cohort `nominalQuota`.
- `cleanExpiredReservations()` — finds resources labeled `rhai-tmm.dev/until` past their timestamp, deletes them, then re-syncs the Cohort.
- `removeStaleReservations()` — deletes resources for users who no longer have active bookings.

The cleaner runs every 10 minutes. Each cycle first calls `syncReservations()` to materialize K8s resources for today's bookings (including bookings made in advance), then checks for expired/stale resources.

#### Testing with helm template

```bash
# No reservations (default)
helm template rbac applications/rbac/ -s templates/reservations.yaml

# Single user reservation
EOD=$(date -d "23:59:59" +%s)
helm template rbac applications/rbac/ -s templates/reservations.yaml \
    --set-json='reservations={"h200": {"userA": {"nvidia.com/mig-2g.35gb": 1, "until": '$EOD'}}}'

# Multiple users
helm template rbac applications/rbac/ -s templates/reservations.yaml \
    --set-json='reservations={"h200": {"userA": {"nvidia.com/mig-2g.35gb": 1, "until": '$EOD'}, "userB": {"nvidia.com/mig-2g.35gb": 1, "until": '$EOD'}}}'
```

#### Key files

- `applications/rbac/templates/reservations.yaml` — main template, iterates calculate-resources output
- `applications/rbac/templates/kueue/_helpers.tpl` — `kueue.cohort`, `kueue.cluster-queue`, `kueue.local-queue`, `kueue.calculate-resources` helpers
- `applications/rbac/values.yaml` — `totalResources`, `reservations`, `resourceFlavors`, `workloadPriorityClasses`
- `applications/booking-app/server/reservations.go` — Go runtime equivalent

## Container based deployment

Makefile, Containerfiles and helm chart for deployment of the backend and frontend apps into a kubernetes Deployment.

- `Containerfile.server` - UBI 10 Go multi-stage build with sqlite-libs, runs as user 1001
- `Containerfile.client` - UBI 9 Node.js multi-stage build with standalone output
- Helm chart deploys 3 containers in a single pod: client (Next.js :3000), server (Go :8080), oauth-proxy (OpenShift :4180)
- PVC for SQLite storage mounted at `/data` on the server container
- ServiceAccount with OAuth redirect annotation for OpenShift SSO
- Route with edge TLS termination through the OAuth proxy

### Helm values

- `server.adminPassword` - admin login password
- `server.bookingWindowDays` - booking window in days (default `"30"`)
- `server.storage.size` - PVC size (default `1Gi`)
- `server.storage.storageClassName` - optional storage class
- `server.kueueSync.enabled` - enable LocalQueue watcher (default `false`)
- `server.kueueSync.interval` - poll interval in seconds (default `"60"`)
- `server.kueueSync.bookingDays` - days to book ahead (default `"0"` = rest of week)
- `oauth.cookieSecret` - OAuth proxy cookie secret
- `route.host` - optional route hostname

