-- Phase 9 — Finance and campaigns
-- Reports themselves (docs/roadmap.md § Fase 9) are read-only aggregations
-- over tables that already exist (orders, payments, production_orders,
-- inventory_*) — no new schema needed for those. This migration only adds
-- what's genuinely new: expenses and marketing campaigns.

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_expense_categories_updated_at
  before update on public.expense_categories
  for each row execute function public.set_updated_at();

insert into public.expense_categories (code, name, sort_order) values
  ('materials', 'Materiales', 1),
  ('rent', 'Alquiler', 2),
  ('utilities', 'Servicios', 3),
  ('marketing', 'Marketing', 4),
  ('shipping', 'Envíos / transporte', 5),
  ('other', 'Otro', 6)
on conflict (code) do nothing;

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  category_id uuid references public.expense_categories (id),
  concept text not null,
  vendor text,
  amount numeric(12, 2) not null check (amount > 0),
  method_id uuid references public.payment_methods (id),
  account_id uuid references public.payment_accounts (id),
  business_unit_id uuid references public.business_units (id),
  event_id uuid references public.events (id),
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index expenses_expense_date_idx on public.expenses (expense_date);
create index expenses_business_unit_id_idx on public.expenses (business_unit_id);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date,
  end_date date,
  objective text,
  investment numeric(12, 2),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_campaigns_updated_at
  before update on public.campaigns
  for each row execute function public.set_updated_at();

-- Deferred since Fase 3 (docs/database.md) — now that campaigns exists.
alter table public.orders add column campaign_id uuid references public.campaigns (id);

-- ============================================================================
-- Row Level Security
-- Expenses and campaigns carry real financial detail (amounts, investment)
-- — per docs/architecture.md's permission table, `viewer` gets "lectura
-- general (sin finanzas)", so unlike every other table so far these are
-- NOT readable by every authenticated user, only owner + operations.
-- ============================================================================

alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;
alter table public.campaigns enable row level security;

create policy "expense_categories_select_authenticated"
  on public.expense_categories for select to authenticated using (true);
create policy "expense_categories_write_owner"
  on public.expense_categories for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

create policy "expenses_select_operations"
  on public.expenses for select to authenticated using (public.is_operations_or_owner());
create policy "expenses_write_operations"
  on public.expenses for all to authenticated
  using (public.is_operations_or_owner()) with check (public.is_operations_or_owner());

create policy "campaigns_select_operations"
  on public.campaigns for select to authenticated using (public.is_operations_or_owner());
create policy "campaigns_write_operations"
  on public.campaigns for all to authenticated
  using (public.is_operations_or_owner()) with check (public.is_operations_or_owner());
