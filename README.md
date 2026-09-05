# Childcare Manager

Attendance, schedules, calendar, child notes, hourly invoicing and a financial
view for a small childcare service. React + TypeScript, no backend — it builds to
static files and runs entirely in the browser.

## What it does

| Area | Detail |
|---|---|
| **Attendance** | Day sheet with check in / check out, drop-ins, absent / sick / holiday, per-day totals. "Fill from schedule" creates the day's records in one click. |
| **Children** | Profiles, guardians and bill payer, allergies and medical notes, per-child hourly rate override, status (active / waitlist / archived). |
| **Schedules** | Recurring weekly blocks per child, with effective-from and effective-to dates so a booking change does not rewrite history. |
| **Calendar** | Month grid showing who is booked, who was recorded, closures, and the value of each day. |
| **Notes** | Per-child log — incident, medical, milestone, behaviour, meal, nap, general — with a follow-up flag, filters and CSV export. |
| **Invoices** | Generated from recorded attendance for a period, per child or for everyone at once. Tax, adjustments, part payments, print / PDF. |
| **Finance** | Month-to-date and year-to-date revenue, received vs invoiced by month, receivables ageing, revenue per child, and the value of care recorded but not yet billed. |

## How charging works

Each attendance record stores the rate that applied on the day, so changing a rate
later never rewrites past invoices. For every day:

1. Clock time is `check out − check in`.
2. That is rounded by the configured increment and direction (default: nearest 15 minutes).
3. A minimum charge is applied if set, then a daily cap if set.
4. A late-collection fee is added per minute past the booked finish time, if set.
5. A non-present day charges nothing — unless you mark it billable, in which case it
   charges the contracted (scheduled) hours. That covers retainer days and public
   holidays on a contracted day.

Anything already on an invoice is locked in the attendance sheet, so a day cannot be
billed twice. Deleting an invoice releases its days again.

Run `npm run selftest` to exercise this logic — 30 checks covering rounding,
minimums, caps, late fees, tax, discounts, part payments and ageing.

## Getting started

```bash
npm install
npm run dev
```

Open the app and either add a child or use **Load sample data** on the dashboard.
All names in the sample data are invented placeholders; **Settings → Data → Start
fresh** clears everything.

Other scripts:

```bash
npm run typecheck   # tsc, no emit
npm run selftest    # billing and invoicing checks
npm run build       # typecheck + production build into dist/
```

## Deploying to GitHub Pages

1. Push this repository to GitHub with `main` as the default branch.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Push to `main`. `.github/workflows/deploy.yml` typechecks, runs the self-test,
   builds with the right asset base and publishes.

The app uses `HashRouter`, so deep links survive a refresh on static hosting.
For a custom domain, add a `CNAME` file to `public/` and set `BASE_PATH=/`.

## Where the data lives — read this before real use

Everything is kept in that browser's `localStorage` on that device. Nothing is sent
anywhere, which is what makes the app free to host and private by default, but it
means:

- **One device, one browser.** No sync between your phone and your laptop.
- **Clearing site data deletes everything.** Export a backup from Settings regularly.
  The app also keeps five automatic daily snapshots, in the same browser storage —
  which is not a backup if the browser profile itself is lost.
- **No login.** Anyone with access to that browser profile can read it.
- **Not multi-user.** Two people editing on two devices will not see each other's work.

`Settings → Data` exports the whole database as JSON, plus attendance and invoices as
CSV. If children's personal details are entered, treat the exports as records
containing personal data and store them accordingly.

## Adding login later

`src/lib/auth.tsx` is a working stub: it exposes `useAuth()` and `RequireAuth`, and
currently treats every session as the signed-in owner. To make it real:

1. Point `signIn` at an identity provider. Never compare passwords in the browser.
2. Set `AUTH_REQUIRED = true` so `RequireAuth` gates the routes.
3. Replace `src/lib/repo.ts` with an API client — it is the only file that touches
   storage, so nothing above it changes.

Step 3 is not optional. A login screen in front of browser-local data is decoration:
the data is still readable in devtools. Real accounts mean moving storage to a server,
which also fixes multi-device sync and multi-user access.

## Layout

```
src/
  types.ts              domain model
  lib/
    repo.ts             the only file that touches storage — swap this for an API
    store.tsx           app state and every mutation
    billing.ts          hours -> money for one day
    invoicing.ts        building invoices, balances, overdue
    finance.ts          the dashboard and finance figures
    dates.ts            local-time date helpers (never UTC — it shifts the day)
    auth.tsx            login stub
    demo.ts             sample data
    selftest.ts         checks for the money logic
  components/           layout, UI primitives, hand-rolled SVG charts
  pages/                one file per screen
```

Chart colours use a categorical palette validated for contrast and colour-vision
deficiency in both light and dark themes; see the top of `src/styles.css`.

## Licence

MIT.
