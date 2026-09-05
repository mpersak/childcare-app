# Childcare Manager

Attendance, schedules, calendar, child notes, hourly invoicing and a financial
view for a small home-based childcare service. React + TypeScript, no backend —
it builds to static files and runs entirely in the browser.

## What it does

| Area | Detail |
|---|---|
| **Sign in / out** | Parent-facing screen with big targets and a full-screen signature pad. Signatures are timestamped when captured, independently of the editable check-in time. |
| **Attendance** | Day sheet with check in / out, drop-ins, absent / sick / holiday, per-day totals, signature evidence against each time. |
| **Calendar** | Day timeline (bookings vs actual, overlap, children on site, now-line), week grid, and a month grid naming who is booked. |
| **Children** | Profiles, guardians and bill payer, allergies and medical notes, per-child rate override, weekly schedule with effective dates. |
| **Notes** | Per-child log — incident, medical, milestone, behaviour, meal, nap — with follow-up flags and filters. |
| **Sign in sheet** | The weekly sheet in the service's format: one numbered row per child per day, booked against actual times, with the captured signatures. Print, CSV, or email. |
| **Invoices** | Generated from recorded attendance, per child or everyone. Tax, adjustments, part payments, print / PDF, email to the bill payer. |
| **Finance** | Month- and year-to-date revenue, invoiced vs received, receivables ageing, revenue per child, and care recorded but not yet billed. |

## Two modes

Opening the app asks **Parents** or **Teacher**.

- **Parents** is the tablet-at-the-door screen: sign in, sign out, nothing else. No
  child details, no notes, no money.
- **Teacher** is the full app. Leaving parent mode asks for the passphrase again, so
  a device left at the door does not expose everything to whoever picks it up.

## Security

Everything persisted is encrypted. A passphrase derives an AES-GCM key with
PBKDF2-SHA256, and that key encrypts the document before it touches localStorage or
GitHub. The GitHub token is encrypted under the same passphrase.

**There is no password reset.** Nothing on a server can recover the data — losing the
passphrase loses everything. That is the price of not running a backend. Write it
down, keep it in a password manager, and export a backup.

## Sync

Settings → Sync connects a **private** GitHub repository. The repo receives only
ciphertext, so an accident there is not a disclosure — but keep it private anyway.

You need a fine-grained personal access token, scoped to that one repository, with
**Contents: read and write**. Nothing else.

Layout in the repo:

```
data/data.json.enc      the whole document, encrypted, rewritten on each sync
data/sig/<ref>.enc      one encrypted signature image, written once, never changed
```

Signatures live in separate files deliberately: the main document is re-uploaded on
every change, and a year of signature images inside it would make that unworkable.
Images are cropped to the ink and scaled down before they are stored.

Sync is compare-and-swap. If another device saved first, the push is rejected and you
are asked which copy to keep rather than one silently overwriting the other.

## Email

Buttons on the sign-in sheet and on invoices open a pre-addressed message — Gmail in a
new tab (which hands off to the Gmail app on a phone), or the device's default mail
app. Choose which in Settings.

**Attachments cannot be added automatically.** Neither `mailto:` nor Gmail's compose
URL accepts a file; doing it properly needs the Gmail API and OAuth. So the flow is:
save the PDF, then attach it in the message that opens. The recipient, subject and
body are already filled in.

Addresses come from the bill payer on each child, and the coordinator address in
Settings.

## Getting data out

- **Readable export (HTML)** — the whole record as one printable file: children,
  guardians, attendance, invoices, notes. Save it wherever you keep records,
  including a Google Drive folder.
- **CSV** — attendance, invoices, notes, and the sign-in sheet.
- **JSON backup** — the full document for re-import.

These exports are **plaintext** and contain children's personal details. Uploading
directly to Google Drive from the browser would need a Google Cloud OAuth client;
it is not wired up.

## How charging works

Each attendance record stores the rate that applied on the day, so changing a rate
later never rewrites past invoices. For every day:

1. Clock time is `check out − check in`.
2. Rounded by the configured increment and direction (default: nearest 15 minutes).
3. A minimum charge is applied if set, then a daily cap if set.
4. A late-collection fee is added per minute past the booked finish, if set.
5. A non-present day charges nothing — unless marked billable, which charges the
   contracted hours. That covers retainer days and public holidays on a booked day.

Anything already on an invoice is locked in the attendance sheet, so a day cannot be
billed twice. Deleting an invoice releases its days again.

`npm run selftest` runs 41 checks over this logic — rounding both directions,
minimums, caps, late fees, tax, discounts, part payments, ageing, and the day
timeline's lane packing and occupancy.

## Getting started

```bash
npm install
npm run dev
```

Set a passphrase on first run, then either add a child or use **Load sample data** in
Settings. Every name in the sample data is an invented placeholder.

```bash
npm run typecheck   # tsc, no emit
npm run selftest    # billing, invoicing and timeline checks
npm run build       # typecheck + production build into dist/
```

## Deploying to GitHub Pages

1. Push to GitHub with `main` as the default branch.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Push to `main`; the workflow typechecks, runs the self-test, builds and publishes.

The app uses `HashRouter`, so deep links survive a refresh on static hosting. For a
custom domain, add a `CNAME` file to `public/` and set `BASE_PATH=/`.

The repository holding the app and the repository holding the data should be separate.
The app repo can be public; the data repo must be private.

## Layout

```
src/
  types.ts              domain model
  lib/
    crypto.ts           PBKDF2 + AES-GCM envelope
    github.ts           Contents API client, compare-and-swap writes
    vault.tsx           the key, all persistence, and sync orchestration
    store.tsx           app state and every mutation
    billing.ts          hours -> money for one day
    invoicing.ts        building invoices, balances, overdue
    finance.ts          dashboard and finance figures
    daygrid.ts          day timeline rows, lanes, occupancy
    dates.ts            local-time date helpers (never UTC — it shifts the day)
    email.ts            Gmail / mailto draft handoff
    exporters.ts        CSV and readable HTML
    demo.ts             sample data
    selftest.ts         checks for the money and timeline logic
  components/           layout, UI primitives, signature pad, SVG charts
  pages/                one file per screen
```

Chart colours use a categorical palette validated for contrast and colour-vision
deficiency in both light and dark themes; see the top of `src/styles.css`.

## Licence

MIT.
