-- Phase 3 — Orders & Payments (core engine)
-- One `orders` table for retail and basic custom orders — wholesale
-- (Fase 5) and every future business unit reuse this same table, never a
-- parallel one. See docs/business-rules.md.

-- ============================================================================
-- Status enum
-- ============================================================================

create type public.order_status as enum (
  'pending',       -- recibido, sin confirmar
  'confirmed',      -- seña o pago inicial recibido
  'in_production',  -- sólo aplica a pedidos personalizados
  'ready',          -- listo para entregar
  'delivered',
  'cancelled'
);

-- ============================================================================
-- Orders
-- ============================================================================

create sequence public.orders_human_code_seq;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  human_code text not null unique,
  business_unit_id uuid not null references public.business_units (id),
  customer_id uuid not null references public.customers (id),
  location_id uuid references public.locations (id),
  origin_channel_id uuid references public.sales_channels (id),
  closing_channel_id uuid references public.sales_channels (id),
  status public.order_status not null default 'pending',
  subtotal numeric(12, 2) not null default 0,
  discount_total numeric(12, 2) not null default 0 check (discount_total >= 0),
  total numeric(12, 2) not null default 0,
  delivery_method text check (delivery_method in ('pickup', 'shipping', 'other')),
  delivery_address text,
  estimated_date date,
  notes text,
  -- Reserved for a future Tienda Nube sync (docs/roadmap.md) — unused today.
  external_source text,
  external_order_id text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index orders_customer_id_idx on public.orders (customer_id);
create index orders_status_idx on public.orders (status);
create index orders_business_unit_id_idx on public.orders (business_unit_id);

create trigger set_orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create or replace function public.generate_order_human_code()
returns trigger
language plpgsql
as $$
begin
  if new.human_code is null then
    new.human_code := 'PED-' || lpad(nextval('public.orders_human_code_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

create trigger orders_generate_human_code
  before insert on public.orders
  for each row execute function public.generate_order_human_code();

-- ============================================================================
-- Order items — price is a SNAPSHOT taken when the item is added, never a
-- live lookup into price_list_items (docs/business-rules.md § Snapshots).
-- ============================================================================

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_variant_id uuid not null references public.product_variants (id),
  quantity integer not null check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  created_at timestamptz not null default now()
);

create index order_items_order_id_idx on public.order_items (order_id);

-- Custom-order details for a specific item: free text, a due date, and an
-- optional reference image. Deliberately 1:1 with order_items rather than
-- N:1 — a personalized item has exactly one customization brief.
create table public.order_item_customizations (
  order_item_id uuid primary key references public.order_items (id) on delete cascade,
  note text,
  due_date date,
  reference_image_path text,
  created_at timestamptz not null default now()
);

-- Keeps orders.subtotal/total authoritative no matter which code path
-- touches order_items — never trust the application layer alone to keep
-- these in sync (docs/business-rules.md § integridad).
create or replace function public.recalculate_order_totals()
returns trigger
language plpgsql
as $$
declare
  affected_order_id uuid := coalesce(new.order_id, old.order_id);
begin
  update public.orders o
  set subtotal = coalesce((
        select sum(quantity * unit_price) from public.order_items where order_id = affected_order_id
      ), 0),
      total = coalesce((
        select sum(quantity * unit_price) from public.order_items where order_id = affected_order_id
      ), 0) - o.discount_total
  where o.id = affected_order_id;
  return null;
end;
$$;

create trigger order_items_recalculate_totals
  after insert or update or delete on public.order_items
  for each row execute function public.recalculate_order_totals();

-- ============================================================================
-- Status history — logged automatically, not something a Server Action has
-- to remember to do (docs/business-rules.md § auditoría obligatoria).
-- ============================================================================

create table public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  status public.order_status not null,
  note text,
  changed_by uuid references public.profiles (id),
  changed_at timestamptz not null default now()
);

-- Split into two functions (rather than one branching on TG_OP) so neither
-- ever references OLD/NEW in a context where the trigger type doesn't
-- guarantee it's meaningful.
create or replace function public.log_order_status_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.order_status_history (order_id, status, changed_by)
  values (new.id, new.status, auth.uid());
  return new;
end;
$$;

create or replace function public.log_order_status_on_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into public.order_status_history (order_id, status, changed_by)
    values (new.id, new.status, auth.uid());
  end if;
  return new;
end;
$$;

create trigger orders_log_status_insert
  after insert on public.orders
  for each row execute function public.log_order_status_on_insert();

create trigger orders_log_status_update
  after update of status on public.orders
  for each row execute function public.log_order_status_on_update();

-- ============================================================================
-- Attachments (private — reference photos, briefs)
-- ============================================================================

create table public.order_attachments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  storage_path text not null,
  uploaded_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

insert into storage.buckets (id, name, public)
values ('order-attachments', 'order-attachments', false)
on conflict (id) do nothing;

create policy "order_attachments_staff_read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'order-attachments');

create policy "order_attachments_staff_write"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'order-attachments' and public.is_operations_or_owner())
  with check (bucket_id = 'order-attachments' and public.is_operations_or_owner());

-- ============================================================================
-- Payments — always separate from orders. "Facturado" ≠ "cobrado": the
-- paid amount is computed as sum(payments), never stored on `orders`, so it
-- can never drift out of sync (docs/business-rules.md § Facturación).
-- ============================================================================

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  method_id uuid references public.payment_methods (id),
  account_id uuid references public.payment_accounts (id),
  paid_at timestamptz not null default now(),
  reference text,
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index payments_order_id_idx on public.payments (order_id);

-- ============================================================================
-- create_order — atomic order + items creation. `security invoker` (the
-- default, spelled out here) so it runs as the calling user: RLS still
-- gates it exactly like a direct insert would, it just guarantees the
-- order never gets created with zero items if anything in the loop fails.
-- ============================================================================

create or replace function public.create_order(
  p_business_unit_id uuid,
  p_customer_id uuid,
  p_location_id uuid,
  p_origin_channel_id uuid,
  p_closing_channel_id uuid,
  p_delivery_method text,
  p_delivery_address text,
  p_estimated_date date,
  p_notes text,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_order_id uuid;
  v_item jsonb;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido necesita al menos un producto.';
  end if;

  insert into public.orders (
    business_unit_id, customer_id, location_id, origin_channel_id,
    closing_channel_id, delivery_method, delivery_address, estimated_date,
    notes, created_by
  ) values (
    p_business_unit_id, p_customer_id, p_location_id, p_origin_channel_id,
    p_closing_channel_id, p_delivery_method, p_delivery_address, p_estimated_date,
    p_notes, auth.uid()
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.order_items (order_id, product_variant_id, quantity, unit_price)
    values (
      v_order_id,
      (v_item ->> 'product_variant_id')::uuid,
      (v_item ->> 'quantity')::integer,
      (v_item ->> 'unit_price')::numeric
    );
  end loop;

  return v_order_id;
end;
$$;

grant execute on function public.create_order to authenticated;

-- ============================================================================
-- Row Level Security — read for any authenticated staff, write for
-- owner + operations (matches docs/architecture.md § Modelo de permisos).
-- ============================================================================

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_customizations enable row level security;
alter table public.order_status_history enable row level security;
alter table public.order_attachments enable row level security;
alter table public.payments enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'orders', 'order_items', 'order_item_customizations',
    'order_attachments', 'payments'
  ]
  loop
    execute format(
      'create policy "%1$s_select_authenticated" on public.%1$s for select to authenticated using (true);',
      t
    );
    execute format(
      'create policy "%1$s_write_operations" on public.%1$s for all to authenticated using (public.is_operations_or_owner()) with check (public.is_operations_or_owner());',
      t
    );
  end loop;
end $$;

-- History is written only by the trigger (SECURITY DEFINER) — staff can
-- read it, but never insert/update/delete it directly.
create policy "order_status_history_select_authenticated"
  on public.order_status_history for select to authenticated using (true);
