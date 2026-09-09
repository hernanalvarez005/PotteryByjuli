-- Phase 4 — Stock
-- Physical stock is never a counter you UPDATE directly — it's always the
-- sum of a ledger (inventory_movements). Available = physical − reserved.
-- See docs/business-rules.md § Stock and § Solicitud mayorista ≠ venta.

-- ============================================================================
-- Inventory items
-- One row per thing that can be counted: a finished product variant, a raw
-- material, or a packaging item. Finished goods are auto-created from
-- product_variants — nobody should ever have to remember to create the
-- inventory side of a new product by hand.
-- ============================================================================

create type public.inventory_item_type as enum ('finished_good', 'raw_material', 'packaging');
create type public.unit_of_measure as enum ('unit', 'kg', 'g', 'l', 'ml', 'm');

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  item_type public.inventory_item_type not null,
  product_variant_id uuid unique references public.product_variants (id) on delete cascade,
  name text,
  unit public.unit_of_measure not null default 'unit',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_items_finished_good_shape check (
    (item_type = 'finished_good' and product_variant_id is not null)
    or (item_type <> 'finished_good' and product_variant_id is null and name is not null)
  )
);

create trigger set_inventory_items_updated_at
  before update on public.inventory_items
  for each row execute function public.set_updated_at();

create or replace function public.create_inventory_item_for_variant()
returns trigger
language plpgsql
as $$
begin
  insert into public.inventory_items (item_type, product_variant_id, unit)
  values ('finished_good', new.id, 'unit');
  return new;
end;
$$;

create trigger product_variants_create_inventory_item
  after insert on public.product_variants
  for each row execute function public.create_inventory_item_for_variant();

-- Backfill: variants created in Fase 2, before this trigger existed.
insert into public.inventory_items (item_type, product_variant_id, unit)
select 'finished_good', pv.id, 'unit'
from public.product_variants pv
where not exists (
  select 1 from public.inventory_items ii where ii.product_variant_id = pv.id
);

-- ============================================================================
-- Movements ledger — append-only, signed quantity (positive = in, negative
-- = out). Physical stock for (item, location) is always SUM(quantity).
-- ============================================================================

create type public.inventory_movement_type as enum (
  'purchase', 'production_in', 'sale', 'transfer_out', 'transfer_in',
  'return', 'workshop_consumption', 'event_consumption',
  'fair_allocation', 'fair_return', 'shrinkage', 'adjustment'
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items (id),
  location_id uuid not null references public.locations (id),
  movement_type public.inventory_movement_type not null,
  quantity numeric(12, 3) not null check (quantity <> 0),
  reference_table text,
  reference_id uuid,
  reason text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index inventory_movements_item_location_idx
  on public.inventory_movements (inventory_item_id, location_id);
create index inventory_movements_reference_idx
  on public.inventory_movements (reference_table, reference_id);

-- ============================================================================
-- Reservations — stock promised to a specific order but not yet shipped.
-- Available = physical − sum(active reservations). Prevents selling the
-- same physical piece twice (docs/business-rules.md § Stock).
-- ============================================================================

create type public.reservation_status as enum ('active', 'released', 'consumed');

create table public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items (id),
  location_id uuid not null references public.locations (id),
  order_id uuid references public.orders (id) on delete cascade,
  quantity numeric(12, 3) not null check (quantity > 0),
  status public.reservation_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index inventory_reservations_item_location_idx
  on public.inventory_reservations (inventory_item_id, location_id)
  where status = 'active';
create index inventory_reservations_order_id_idx on public.inventory_reservations (order_id);

create trigger set_inventory_reservations_updated_at
  before update on public.inventory_reservations
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Thresholds — minimum stock per item (optionally per location) before it
-- shows up as "bajo"/"crítico" (sección 24).
-- ============================================================================

create table public.stock_thresholds (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items (id),
  location_id uuid references public.locations (id),
  min_quantity numeric(12, 3) not null check (min_quantity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (inventory_item_id, location_id)
);

create trigger set_stock_thresholds_updated_at
  before update on public.stock_thresholds
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Transfers between locations — never a sale. Completing one is atomic: an
-- out-movement and an in-movement happen together or not at all.
-- ============================================================================

create type public.transfer_status as enum ('pending', 'completed', 'cancelled');

create sequence public.stock_transfers_human_code_seq;

create table public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  human_code text not null unique,
  from_location_id uuid not null references public.locations (id),
  to_location_id uuid not null references public.locations (id),
  status public.transfer_status not null default 'pending',
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint stock_transfers_different_locations check (from_location_id <> to_location_id)
);

create or replace function public.generate_transfer_human_code()
returns trigger
language plpgsql
as $$
begin
  if new.human_code is null then
    new.human_code := 'TRA-' || lpad(nextval('public.stock_transfers_human_code_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

create trigger stock_transfers_generate_human_code
  before insert on public.stock_transfers
  for each row execute function public.generate_transfer_human_code();

create table public.stock_transfer_items (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.stock_transfers (id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items (id),
  quantity numeric(12, 3) not null check (quantity > 0)
);

create index stock_transfer_items_transfer_id_idx on public.stock_transfer_items (transfer_id);

-- Moves stock for every line of a pending transfer in one transaction —
-- checks available stock at the source first; if any line is short, the
-- whole thing is rolled back (nothing half-transferred).
create or replace function public.complete_stock_transfer(p_transfer_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
  v_transfer public.stock_transfers%rowtype;
  v_item public.stock_transfer_items%rowtype;
  v_available numeric;
begin
  select * into v_transfer from public.stock_transfers where id = p_transfer_id for update;

  if v_transfer.id is null then
    raise exception 'Transferencia no encontrada.';
  end if;
  if v_transfer.status <> 'pending' then
    raise exception 'La transferencia ya fue % .', v_transfer.status;
  end if;

  for v_item in
    select * from public.stock_transfer_items where transfer_id = p_transfer_id
  loop
    select coalesce(sum(quantity), 0) into v_available
    from public.inventory_movements
    where inventory_item_id = v_item.inventory_item_id
      and location_id = v_transfer.from_location_id;

    if v_available < v_item.quantity then
      raise exception 'Stock insuficiente en origen para uno de los productos (disponible: %, pedido: %).',
        v_available, v_item.quantity;
    end if;

    insert into public.inventory_movements
      (inventory_item_id, location_id, movement_type, quantity, reference_table, reference_id, created_by)
    values
      (v_item.inventory_item_id, v_transfer.from_location_id, 'transfer_out', -v_item.quantity, 'stock_transfers', p_transfer_id, auth.uid());

    insert into public.inventory_movements
      (inventory_item_id, location_id, movement_type, quantity, reference_table, reference_id, created_by)
    values
      (v_item.inventory_item_id, v_transfer.to_location_id, 'transfer_in', v_item.quantity, 'stock_transfers', p_transfer_id, auth.uid());
  end loop;

  update public.stock_transfers
  set status = 'completed', completed_at = now()
  where id = p_transfer_id;
end;
$$;

grant execute on function public.complete_stock_transfer to authenticated;

-- ============================================================================
-- Order ↔ stock integration (sección 88-89): a wholesale/retail request is
-- NOT a sale. Confirming an order reserves what's physically available and
-- makes the rest visible as a production need; delivering it consumes the
-- reservation; cancelling releases it. Replaces the plain `update orders
-- set status = ...` used since Fase 3 — the app now calls this instead.
-- ============================================================================

create or replace function public.set_order_status(p_order_id uuid, p_new_status public.order_status)
returns void
language plpgsql
security invoker
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'Pedido no encontrado.';
  end if;

  if p_new_status = 'confirmed' and v_order.status = 'pending' then
    if v_order.location_id is null then
      raise exception 'Elegí una ubicación para el pedido antes de confirmarlo.';
    end if;

    for v_item in
      select oi.product_variant_id, oi.quantity, ii.id as inventory_item_id
      from public.order_items oi
      join public.inventory_items ii on ii.product_variant_id = oi.product_variant_id
      where oi.order_id = p_order_id
    loop
      insert into public.inventory_reservations
        (inventory_item_id, location_id, order_id, quantity, status)
      values
        (v_item.inventory_item_id, v_order.location_id, p_order_id, v_item.quantity, 'active');
    end loop;
  end if;

  if p_new_status = 'delivered' then
    for v_item in
      select * from public.inventory_reservations
      where order_id = p_order_id and status = 'active'
    loop
      insert into public.inventory_movements
        (inventory_item_id, location_id, movement_type, quantity, reference_table, reference_id, created_by)
      values
        (v_item.inventory_item_id, v_item.location_id, 'sale', -v_item.quantity, 'orders', p_order_id, auth.uid());

      update public.inventory_reservations set status = 'consumed' where id = v_item.id;
    end loop;
  end if;

  if p_new_status = 'cancelled' then
    update public.inventory_reservations
    set status = 'released'
    where order_id = p_order_id and status = 'active';
  end if;

  update public.orders set status = p_new_status where id = p_order_id;
end;
$$;

grant execute on function public.set_order_status to authenticated;

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.inventory_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.inventory_reservations enable row level security;
alter table public.stock_thresholds enable row level security;
alter table public.stock_transfers enable row level security;
alter table public.stock_transfer_items enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'inventory_items', 'inventory_reservations',
    'stock_thresholds', 'stock_transfers', 'stock_transfer_items'
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

-- inventory_movements is an append-only ledger: readable by staff, but only
-- ever INSERTed (by set_order_status/complete_stock_transfer or a manual
-- adjustment) — no UPDATE/DELETE policy exists, so no role, owner
-- included, can rewrite history through the API (sección 19).
create policy "inventory_movements_select_authenticated"
  on public.inventory_movements for select to authenticated using (true);
create policy "inventory_movements_insert_operations"
  on public.inventory_movements for insert to authenticated
  with check (public.is_operations_or_owner());
