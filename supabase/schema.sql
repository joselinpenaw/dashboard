-- ============================================================
-- Workspace Dashboard — Supabase schema, roles & security
-- Run this in Supabase → SQL Editor → New query → Run.
-- Safe to re-run.
-- ============================================================

-- ---------- Profiles (one row per user; mirrors auth.users) ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  title       text,
  phone       text,
  location    text,
  role        text not null default 'employee' check (role in ('admin','employee')),
  status      text not null default 'active',
  dept        text,
  created_at  timestamptz not null default now()
);

-- Helper: is the current user an admin?
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin');
$$;

-- Auto-create a profile when a new auth user is created.
-- The FIRST user to sign up becomes the admin; everyone after is an employee.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare first_user boolean;
begin
  select count(*) = 0 into first_user from public.profiles;
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    case when first_user then 'admin' else coalesce(new.raw_user_meta_data->>'role','employee') end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Time entries (employees clock in/out) ----------
create table if not exists public.time_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  project    text,
  clock_in   timestamptz not null default now(),
  clock_out  timestamptz,             -- null = still on the clock
  created_at timestamptz not null default now()
);

-- ---------- Contracts (admin assigns; employee signs) ----------
create table if not exists public.contracts (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  file_name   text,
  file_url    text,
  value       numeric default 0,
  assigned_to uuid references public.profiles(id) on delete set null,
  status      text not null default 'draft' check (status in ('draft','invited','signed','declined','expired')),
  created_by  uuid references public.profiles(id) on delete set null,
  sent_at     timestamptz,
  signed_at   timestamptz,
  due         timestamptz,
  created_at  timestamptz not null default now()
);

-- ---------- Notifications (e.g. "employee signed a contract") ----------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade, -- recipient (admin)
  type       text,
  message    text,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- Admin-only workspace data ----------
create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  owner uuid references public.profiles(id) on delete cascade,
  company text, role text, status text, location text, salary text,
  source text, applied timestamptz, interview_date timestamptz, notes text,
  created_at timestamptz not null default now()
);
create table if not exists public.sops (
  id uuid primary key default gen_random_uuid(),
  title text, category text, version text, file_name text, file_url text,
  uploaded_by text, created_at timestamptz not null default now()
);
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  type text, descr text, category text, amount numeric, status text,
  date timestamptz, created_at timestamptz not null default now()
);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.profiles      enable row level security;
alter table public.time_entries  enable row level security;
alter table public.contracts     enable row level security;
alter table public.notifications enable row level security;
alter table public.applications  enable row level security;
alter table public.sops          enable row level security;
alter table public.transactions  enable row level security;

-- profiles: read own or (admin reads all); update own or admin updates all
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert
  with check (id = auth.uid() or public.is_admin());

-- time_entries: employee manages own; admin sees all
drop policy if exists te_select on public.time_entries;
create policy te_select on public.time_entries for select
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists te_write on public.time_entries;
create policy te_write on public.time_entries for all
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- contracts: admin full; assignee can read + update (to sign) their own
drop policy if exists ct_select on public.contracts;
create policy ct_select on public.contracts for select
  using (assigned_to = auth.uid() or public.is_admin());
drop policy if exists ct_admin on public.contracts;
create policy ct_admin on public.contracts for all
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists ct_sign on public.contracts;
create policy ct_sign on public.contracts for update
  using (assigned_to = auth.uid()) with check (assigned_to = auth.uid());

-- notifications: recipient reads/updates own; anyone authenticated can insert
drop policy if exists nt_own on public.notifications;
create policy nt_own on public.notifications for select
  using (user_id = auth.uid());
drop policy if exists nt_upd on public.notifications;
create policy nt_upd on public.notifications for update
  using (user_id = auth.uid());
drop policy if exists nt_ins on public.notifications;
create policy nt_ins on public.notifications for insert
  with check (auth.uid() is not null);

-- admin-only tables
drop policy if exists app_admin on public.applications;
create policy app_admin on public.applications for all
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists sops_admin on public.sops;
create policy sops_admin on public.sops for all
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists tx_admin on public.transactions;
create policy tx_admin on public.transactions for all
  using (public.is_admin()) with check (public.is_admin());

-- Done.
