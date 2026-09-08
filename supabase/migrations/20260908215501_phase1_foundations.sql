-- Phase 1 — Foundations
-- Auth/roles, configuration catalogs shared by every business unit.
-- See docs/database.md for the full data-model rationale.

-- ============================================================================
-- Extensions
-- ============================================================================
create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ============================================================================
-- Shared helpers
-- ============================================================================

-- Generic updated_at maintenance, reused by every table that has the column.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- Roles & profiles
-- ============================================================================

-- Small, fixed set of system roles -> Postgres enum (not a configurable
-- catalog; changing this set is a code change, per docs/business-rules.md).
create type public.app_role as enum ('owner', 'operations', 'workshop_staff', 'viewer');

-- One row per auth user, created automatically by the trigger below.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  avatar_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- A user can hold more than one role (e.g. owner also doing workshop_staff work).
create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- SECURITY DEFINER helpers so RLS policies can check roles without
-- recursively querying user_roles (which would fail under RLS).
create or replace function public.has_role(check_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = check_role
  );
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('owner');
$$;

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- Configuration catalogs
-- Shared across every business unit — never re-created per module.
-- ============================================================================

create table public.business_units (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  location_type text not null default 'store'
    check (location_type in ('store', 'warehouse', 'fair', 'showroom', 'other')),
  city text,
  province text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Used both as "origen comercial" and "canal de cierre" on orders — same
-- catalog, two independent foreign keys (see docs/business-rules.md #3).
create table public.sales_channels (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Cash/bank/MercadoPago "cajas" — where money actually sits (section 40).
create table public.payment_accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  account_type text not null default 'cash'
    check (account_type in ('cash', 'bank', 'digital_wallet', 'other')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Free-form key/value app settings (e.g. future wholesale minimums override,
-- feature flags). Dedicated tables are preferred once a config area grows
-- past a couple of scalar values — see docs/business-rules.md.
create table public.settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

create trigger set_business_units_updated_at before update on public.business_units
  for each row execute function public.set_updated_at();
create trigger set_locations_updated_at before update on public.locations
  for each row execute function public.set_updated_at();
create trigger set_sales_channels_updated_at before update on public.sales_channels
  for each row execute function public.set_updated_at();
create trigger set_payment_methods_updated_at before update on public.payment_methods
  for each row execute function public.set_updated_at();
create trigger set_payment_accounts_updated_at before update on public.payment_accounts
  for each row execute function public.set_updated_at();
create trigger set_settings_updated_at before update on public.settings
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Row Level Security
-- Every table in this app is internal/staff-only in Phase 1 — there is no
-- public catalog yet (that arrives in Phase 5 with its own, narrow policies).
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.business_units enable row level security;
alter table public.locations enable row level security;
alter table public.sales_channels enable row level security;
alter table public.payment_methods enable row level security;
alter table public.payment_accounts enable row level security;
alter table public.settings enable row level security;

-- profiles: everyone signed in can see the staff directory (small team);
-- a user can only edit their own row; owners can edit anyone's.
create policy "profiles_select_authenticated" on public.profiles
  for select to authenticated using (true);
create policy "profiles_update_self" on public.profiles
  for update to authenticated using (id = auth.uid());
create policy "profiles_update_owner" on public.profiles
  for update to authenticated using (public.is_owner());

-- user_roles: a user can see their own roles; owners manage everyone's.
create policy "user_roles_select_self" on public.user_roles
  for select to authenticated using (user_id = auth.uid());
create policy "user_roles_select_owner" on public.user_roles
  for select to authenticated using (public.is_owner());
create policy "user_roles_write_owner" on public.user_roles
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- Configuration catalogs: any authenticated staff member can read (needed
-- to populate dropdowns everywhere); only owners can write. Non-owner roles
-- (operations, workshop_staff) get read-only access to configuration.
do $$
declare
  t text;
begin
  foreach t in array array[
    'business_units', 'locations', 'sales_channels',
    'payment_methods', 'payment_accounts', 'settings'
  ]
  loop
    execute format(
      'create policy "%1$s_select_authenticated" on public.%1$s for select to authenticated using (true);',
      t
    );
    execute format(
      'create policy "%1$s_write_owner" on public.%1$s for all to authenticated using (public.is_owner()) with check (public.is_owner());',
      t
    );
  end loop;
end $$;

-- ============================================================================
-- Seed: configuration values described throughout the spec (section 76).
-- Safe to run repeatedly; no customer data, no destructive statements.
-- ============================================================================

insert into public.business_units (code, name, sort_order) values
  ('retail', 'Minorista', 1),
  ('wholesale', 'Mayorista', 2),
  ('custom', 'Personalizados', 3),
  ('classes', 'Talleres', 4),
  ('workshops', 'Workshops', 5),
  ('fairs', 'Ferias', 6)
on conflict (code) do nothing;

insert into public.locations (code, name, location_type, city, province) values
  ('la-plata', 'La Plata', 'store', 'La Plata', 'Buenos Aires'),
  ('tres-lomas', 'Tres Lomas', 'store', 'Tres Lomas', 'Buenos Aires')
on conflict (code) do nothing;

insert into public.sales_channels (code, name, sort_order) values
  ('instagram', 'Instagram', 1),
  ('whatsapp', 'WhatsApp', 2),
  ('tienda_nube', 'Tienda Nube', 3),
  ('in_person', 'Presencial', 4),
  ('fair', 'Feria', 5),
  ('referral', 'Referido', 6),
  ('other', 'Otro', 7)
on conflict (code) do nothing;

insert into public.payment_methods (code, name, sort_order) values
  ('cash', 'Efectivo', 1),
  ('bank_transfer', 'Transferencia', 2),
  ('mercado_pago', 'Mercado Pago', 3),
  ('card', 'Tarjeta', 4),
  ('other', 'Otro', 5)
on conflict (code) do nothing;

insert into public.payment_accounts (code, name, account_type) values
  ('cash-box', 'Caja efectivo', 'cash'),
  ('bank-account', 'Cuenta bancaria', 'bank'),
  ('mercado-pago', 'Mercado Pago', 'digital_wallet')
on conflict (code) do nothing;
