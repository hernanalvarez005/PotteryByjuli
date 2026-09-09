-- Phase 8 — Punctual workshops and fairs
-- Deliberate simplification vs. the original spec's separate
-- `event_inventory_allocations` table: a fair IS a `locations` row
-- (location_type = 'fair', already supported since Fase 1), so sending
-- and returning stock reuses stock_transfers, and sales at the fair reuse
-- orders — exactly the "extend the core" rule from docs/business-rules.md.
-- events.location_id + the new event_id tags on orders/stock_transfers are
-- enough to build the "unidades llevadas/vendidas/devueltas" summary
-- without a parallel stock model.

create type public.event_type as enum ('workshop', 'fair');
create type public.event_status as enum ('planned', 'confirmed', 'completed', 'cancelled');
create type public.registration_status as enum ('registered', 'cancelled');

create sequence public.events_human_code_seq;

create table public.events (
  id uuid primary key default gen_random_uuid(),
  human_code text not null unique,
  event_type public.event_type not null,
  name text not null,
  location_id uuid references public.locations (id),
  event_date date not null,
  schedule text,
  capacity integer check (capacity > 0),
  price numeric(12, 2),
  cost_estimate numeric(12, 2),
  status public.event_status not null default 'planned',
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_events_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

create or replace function public.generate_event_human_code()
returns trigger
language plpgsql
as $$
begin
  if new.human_code is null then
    new.human_code := (case when new.event_type = 'fair' then 'FER-' else 'WOR-' end)
      || lpad(nextval('public.events_human_code_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

create trigger events_generate_human_code
  before insert on public.events
  for each row execute function public.generate_event_human_code();

create table public.event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  customer_id uuid not null references public.customers (id),
  quantity integer not null default 1 check (quantity > 0),
  unit_price numeric(12, 2),
  is_paid boolean not null default false,
  paid_at timestamptz,
  status public.registration_status not null default 'registered',
  notes text,
  created_at timestamptz not null default now()
);

create index event_registrations_event_id_idx on public.event_registrations (event_id);

-- Same "never oversell a spot" guarantee as workshop_enrollments — only
-- checked when the event actually declares a capacity (fairs usually don't).
create or replace function public.check_event_capacity()
returns trigger
language plpgsql
as $$
declare
  v_capacity integer;
  v_registered integer;
begin
  if new.status <> 'registered' then
    return new;
  end if;

  select capacity into v_capacity from public.events where id = new.event_id;
  if v_capacity is null then
    return new;
  end if;

  select coalesce(sum(quantity), 0) into v_registered
  from public.event_registrations
  where event_id = new.event_id and status = 'registered'
    and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if v_registered + new.quantity > v_capacity then
    raise exception 'No hay cupo suficiente (disponible: %, pedido: %).', v_capacity - v_registered, new.quantity;
  end if;

  return new;
end;
$$;

create trigger event_registrations_check_capacity
  before insert or update of quantity, status on public.event_registrations
  for each row execute function public.check_event_capacity();

-- Optional tags so a fair's page can show exactly which sales and stock
-- movements belong to it, without a parallel allocation model.
alter table public.orders add column event_id uuid references public.events (id);
alter table public.stock_transfers add column event_id uuid references public.events (id);

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.events enable row level security;
alter table public.event_registrations enable row level security;

create policy "events_select_authenticated"
  on public.events for select to authenticated using (true);
create policy "events_write_workshop_staff"
  on public.events for all to authenticated
  using (public.is_workshop_staff_or_above()) with check (public.is_workshop_staff_or_above());

create policy "event_registrations_select_authenticated"
  on public.event_registrations for select to authenticated using (true);
create policy "event_registrations_write_workshop_staff"
  on public.event_registrations for all to authenticated
  using (public.is_workshop_staff_or_above()) with check (public.is_workshop_staff_or_above());
