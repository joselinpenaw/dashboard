# Workspace Dashboard

A single-page **team workspace + personal career dashboard**. It runs two ways:

1. **Standalone** — open `index.html` and it works immediately, storing everything
   in the browser via `localStorage`. No accounts, no server, no setup.
2. **Multi-user team platform** — add a Supabase backend + a Vercel deploy and it
   becomes a real multi-seat app with email/password login, an **admin** and
   **employees**, role-based access, a shared database, e-signatures, live job
   feeds and hands-free email.

The front end is plain HTML + CSS + vanilla JavaScript — **no framework, no build
tooling required.** The app auto-detects whether a backend is configured
(`assets/js/config.js`) and switches modes at runtime: every view has a
local-storage path and a Supabase (`DB`) path.

- **Live app:** `https://dashboard-noah25.vercel.app`
- **Repo:** `anonomyous-coder/dashboard`

---

## Contents

- [What's in it](#whats-in-it)
- [Roles & access](#roles--access)
- [Architecture](#architecture)
- [Standalone mode](#standalone-mode-zero-setup)
- [Team mode — full setup](#team-mode--full-setup)
  - [1. Supabase](#1-supabase-database--auth)
  - [2. Vercel env vars](#2-vercel-environment-variables)
  - [3. Gmail OAuth](#3-gmail-oauth-sync--hands-free-send)
  - [4. Adzuna](#4-adzuna-live-job-search)
- [Cron jobs](#cron-jobs)
- [Build & deploy](#build--deploy)
- [How the hard parts work](#how-the-hard-parts-work)

---

## What's in it

### Personal

| Section | What it does |
| --- | --- |
| **My Dashboard** | Date + "Welcome back {name}", a range filter (Today / 7 / 15 / 30 days) and KPI cards — Applications, Time tracked, Contracts pending, SOPs available — plus Recent application activity, Pending contracts and Quick links. |
| **Job Applications** | Tracks applications through **Applied → Interview → Offer / Rejected**. Can **sync with Gmail** (read-only) to auto-classify "thanks for applying", interview, offer and rejection emails into the pipeline. |
| **Time Tracker** | **Clock in / out** with a live timer against a **department** ("what are you working on"). Each employee sees **only their own** hours. Includes **weekly timesheet submission** — employees submit each week, the admin reviews. |
| **Insights** | Analytics across applications, hours and the workspace. |
| **Job Search** | Pulls **live remote roles daily from Adzuna**, split into tabs: **SDR / BDR** and **Medical Coding** (and All). Backed by a daily cron. |
| **My Account** | Profile, **profile picture** (shown on the avatar), **address** and **ID number**, a **built-in signature** (draw or upload an image) used when signing contracts, and a **Connect Gmail for sending** card. |

### Workspace

| Section | What it does |
| --- | --- |
| **SOPs** | Admin uploads/hosts documents and can **assign an SOP to a specific employee** — it shows on that employee's end **only if assigned**. Click a doc to open it in a viewer modal. |
| **Contracts** | DocuSign-style flow: **upload a PDF/image, preview the whole document, and drop fields onto it** (name, address, signature, phone, date, **Company signature**). Fields are placed one-per-selection and can be **dragged and corner-resized**. A clear **Send to sign** button **emails the employee automatically**. Employees sign with their saved signature; the admin's **Company signature** auto-stamps; the **admin is pinged** when someone signs. |
| **Payroll & Expenses** | Record payroll runs and expenses, approve pending items, see totals. |
| **Applicants** | Hiring pipeline (review → screening → interview → offer → hired). |
| **Team** | Admin **creates employee accounts with passwords**, **invites** by email (auto-sent), **edits** a member's account (name, role, dept, **contact/login email**, ID, address), toggles admin/employee, and can **"View as"** an employee to flip through their account. |

---

## Roles & access

Role-based navigation is enforced in `app.js` (`EMPLOYEE_ROUTES` / `allowedRoutes()`):

- **Employee** sees only **Time Tracker, My Account, Contracts, and SOPs**.
- **Admin** sees **everything**, can create/edit employee accounts, review
  timesheets, assign SOPs and contracts, and **View as** any employee.

In team mode the **first user to sign up becomes the admin**; everyone created
after is an employee (enforced by a Postgres trigger — see schema). On the
server, every privileged API call re-verifies the caller's `role = 'admin'`
before doing anything.

---

## Architecture

```
index.html                  app shell (sidebar, topbar, content, modal + toast hosts)
assets/css/style.css         cyber "SOC" dark theme — CSS tokens, HUD grid, glass panels
assets/js/config.js          window.APP_CONFIG — Supabase URL + anon key (public-safe)
assets/js/store.js           localStorage data layer (standalone mode); clean-slate seed
assets/js/ui.js              formatting, modals, toasts, confirm, form builder, empty states
assets/js/gmail.js           in-browser Gmail: read-only sync + send (Google Identity Services)
assets/js/auth.js            Supabase auth (sign in/up/out, profile, isAdmin)
assets/js/db.js              Supabase data layer (profiles, time, contracts, sops, timesheets…)
assets/js/esign.js           pdf.js document render + field-placement editor / signer / viewer
assets/js/views.js           every section view (each with a localStorage path + a DB path)
assets/js/app.js             router, role-filtered nav, view-as banner, notification bell

api/jobs.js                  Adzuna search (SDR/BDR + medical coding), relevance-filtered
api/admin.js                 admin-only user management (create/update users, passwords)
api/email.js                 server-side email send via the admin's Gmail refresh token
api/gmail-connect.js         exchanges a Google auth code for a stored refresh token
api/remind.js                Friday cron — nudges employees who haven't submitted a timesheet
supabase/schema.sql          tables, Row Level Security, roles, triggers
vercel.json                  cron schedules
build.js                     concatenates the JS into a single-file dist/dashboard.html
```

**No-build bundling:** `build.js` inlines `config → store → ui → gmail → auth → db
→ esign → views → app` into `dist/dashboard.html`. External libraries (Google
Identity Services, supabase-js, pdf.js) stay as CDN `<script>` tags.

---

## Standalone mode (zero setup)

```bash
python3 -m http.server 8000   # any static server works
# open http://localhost:8000
```

Or just open `index.html`. Data persists in `localStorage` under
`workspace_dashboard_v1`. The seed is a **clean slate** (empty lists, default
profile name "Noah Morgan"). Use the **theme toggle** (top-right) for light/dark.

If `assets/js/config.js` has no Supabase URL/key (or supabase-js didn't load),
auth is disabled and the app runs fully local — nothing breaks.

---

## Team mode — full setup

Four integrations, each independent — add only the ones you want. The app
degrades gracefully when one is missing (e.g. a one-click Gmail compose fallback
and in-app notifications work with no server at all).

### 1. Supabase (database + auth)

Create a Supabase project, then **SQL Editor → run `supabase/schema.sql`**. That
creates `profiles`, `time_entries`, `contracts`, `notifications`,
`applications`, `sops`, `transactions`, the `is_admin()` helper, Row Level
Security on every table, and the trigger that makes the first signup the admin.

Then run this **additional migration** for the later features (assignable SOPs,
departments, weekly timesheets, e-sign fields, profile extras, and the Gmail
token store). It is safe to re-run:

```sql
-- Profile extras: photo, built-in signature, ID, address
alter table public.profiles add column if not exists avatar_url    text;
alter table public.profiles add column if not exists signature_url text;
alter table public.profiles add column if not exists id_number     text;
alter table public.profiles add column if not exists address       text;

-- Contracts: placed fields + captured values (DocuSign-style)
alter table public.contracts add column if not exists fields       jsonb default '[]'::jsonb;
alter table public.contracts add column if not exists field_values jsonb default '{}'::jsonb;

-- SOPs: assign to one employee (and let that employee read theirs)
alter table public.sops add column if not exists assigned_to uuid references public.profiles(id) on delete set null;
drop policy if exists sops_read on public.sops;
create policy sops_read on public.sops for select
  using (public.is_admin() or assigned_to = auth.uid());

-- Departments (admin-managed; shown as clock-in options)
create table if not exists public.departments (
  id   uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
alter table public.departments enable row level security;
drop policy if exists dept_read  on public.departments;
create policy dept_read  on public.departments for select using (auth.uid() is not null);
drop policy if exists dept_admin on public.departments;
create policy dept_admin on public.departments for all using (public.is_admin()) with check (public.is_admin());

-- Weekly timesheets (employee submits; admin reviews)
create table if not exists public.timesheets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  week_start  date not null,
  hours       numeric default 0,
  note        text,
  status      text not null default 'submitted',
  submitted_at timestamptz,
  reviewed_at  timestamptz,
  created_at  timestamptz not null default now(),
  unique (user_id, week_start)
);
alter table public.timesheets enable row level security;
drop policy if exists ts_select on public.timesheets;
create policy ts_select on public.timesheets for select
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists ts_write on public.timesheets;
create policy ts_write on public.timesheets for all
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- Server-side config store (holds the Gmail refresh token; service-role only)
create table if not exists public.app_config (
  key   text primary key,
  value text
);
alter table public.app_config enable row level security;  -- no policies = only service_role can touch it
```

Put the project's **URL** and **anon key** into `assets/js/config.js`. The anon
key is public-safe by design — all access is gated by the RLS policies above.
The **service_role key is secret** and lives only in Vercel env vars (below),
never in client code.

### 2. Vercel environment variables

Deploy the repo to Vercel, then add (Settings → Environment Variables) and
redeploy:

| Variable | Used by | What it is |
| --- | --- | --- |
| `SUPABASE_URL` | admin, email, remind | your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | admin, email, remind | Supabase → Project Settings → API → **service_role** secret |
| `GOOGLE_CLIENT_ID` | email, gmail-connect | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | email, gmail-connect | Google OAuth client secret |
| `ADZUNA_APP_ID` | jobs | Adzuna API app id |
| `ADZUNA_APP_KEY` | jobs | Adzuna API app key |

> Use the **stable production URL** (`dashboard-noah25.vercel.app`), not Vercel
> preview URLs — preview URLs have a random hash that breaks the Google OAuth
> origin and gives each deploy a separate data origin.

### 3. Gmail OAuth (sync + hands-free send)

Two separate capabilities, both via one Google OAuth client:

- **Sync (read-only, in-browser):** `gmail.js` uses Google Identity Services to
  get a `gmail.readonly` token that lives only in memory for the session, pulls
  the last year of job-related mail, and classifies it into the Applications
  pipeline. The user pastes their OAuth **Client ID** once (stored in the
  browser). Requirements in Google Cloud: Gmail API enabled, the exact JS origin
  registered under **Authorized JavaScript origins** (no trailing slash), and —
  while the app is in testing — the signing-in account added under
  **Audience → Test users**.
- **Send (hands-free, server-side):** so the admin doesn't sign in for every
  email, **My Account → Connect Gmail for sending** runs the OAuth *code* flow
  once; `api/gmail-connect.js` exchanges the code for a **refresh token** and
  stores it in `app_config`. From then on `api/email.js` refreshes an access
  token server-side and sends via the Gmail API with no interaction — used for
  contract "Send to sign", team invites and the weekly reminder.

If Gmail send isn't connected, the app falls back to a one-click compose link
plus an in-app notification, so nothing is blocked.

### 4. Adzuna (live job search)

`api/jobs.js` runs targeted per-term Adzuna queries (SDR / BDR, plus medical
coder / coding / billing / risk adjustment / coding specialist), de-duplicates,
filters to genuinely-remote and on-topic roles, and returns
`{ jobs, count, counts: { sales, coding } }`. Results are cached for ~24h — use
**Refresh from Adzuna** in Job Search to force a fresh pull.

---

## Cron jobs

Defined in `vercel.json`:

| Schedule | Path | What it does |
| --- | --- | --- |
| `0 13 * * *` (daily) | `/api/jobs` | refresh the live Adzuna job feed |
| `0 21 * * 5` (Fridays) | `/api/remind` | notify (and, if Gmail is connected, email) any employee who hasn't submitted this week's timesheet |

---

## Build & deploy

```bash
node build.js          # regenerates dist/dashboard.html (single self-contained file)
```

The app is a static site + Vercel serverless functions in `/api`. Push to the
repo and Vercel deploys automatically. GitHub Pages also works for the static
front end, but the `/api` functions (admin, email, jobs, remind) require Vercel.

---

## How the hard parts work

- **Two runtimes, one codebase.** Every view checks `window.DB && window.DB.active`
  and takes the Supabase path when a backend is configured, otherwise the
  `localStorage` path. This is why the app works with zero setup and still scales
  to a real multi-user deployment.
- **Security model.** The browser only ever holds the **anon** key; RLS makes
  that safe. Anything privileged (creating users, setting passwords, sending
  mail) goes through a serverless function that holds the **service_role** key
  and re-checks `role = 'admin'` from the caller's token first.
- **E-signatures.** `esign.js` renders a PDF (via pdf.js) or image into pages,
  lets the admin place typed field boxes positioned in **percentage** coordinates
  (so they survive any zoom), and stores them on the contract. Signers see the
  same document with their fields; their saved signature and the admin's Company
  signature are stamped in; the admin gets a notification on signing.
- **Clean slate.** A one-time migration in `store.js` clears the old sample data
  but preserves profile, Gmail client id and any pulled live jobs.
