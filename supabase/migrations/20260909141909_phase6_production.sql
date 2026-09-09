-- Phase 6 — Production
-- Connects to orders and stock: confirming an order now reserves what's
-- physically available and raises a production_order for whatever is
-- short (sección 89) — nobody has to notice the gap and create it by hand.

create type public.production_priority as enum ('low', 'normal', 'high');
create type public.production_status as enum (
  'pending', 'modeling', 'drying', 'first_firing', 'glazing',
  'second_firing', 'quality_check', 'done', 'cancelled'
);
create type public.production_origin as enum (
  'restock', 'retail_order', 'wholesale_order', 'custom_order', 'workshop', 'fair'
);

create sequence public.production_orders_human_code_seq;

create table public.production_orders (
  id uuid primary key default gen_random_uuid(),
  human_code text not null unique,
  origin public.production_origin not null default 'restock',
  order_id uuid references public.orders (id) on delete set null,
  product_variant_id uuid not null references public.product_variants (id),
  location_id uuid not null references public.locations (id),
  quantity integer not null check (quantity > 0),
  produced_quantity integer not null default 0 check (produced_quantity >= 0),
  rejected_quantity integer not null default 0 check (rejected_quantity >= 0),
  priority public.production_priority not null default 'normal',
  status public.production_status not null default 'pending',
  target_date date,
  assigned_to uuid references public.profiles (id),
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index production_orders_status_idx on public.production_orders (status);
create index production_orders_order_id_idx on public.production_orders (order_id);

create trigger set_production_orders_updated_at
  before update on public.production_orders
  for each row execute function public.set_updated_at();

create or replace function public.generate_production_order_human_code()
returns trigger
language plpgsql
as $$
begin
  if new.human_code is null then
    new.human_code := 'PRO-' || lpad(nextval('public.production_orders_human_code_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

create trigger production_orders_generate_human_code
  before insert on public.production_orders
  for each row execute function public.generate_production_order_human_code();

create table public.production_stage_events (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references public.production_orders (id) on delete cascade,
  status public.production_status not null,
  note text,
  changed_by uuid references public.profiles (id),
  changed_at timestamptz not null default now()
);

create or replace function public.log_production_status_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.production_stage_events (production_order_id, status, changed_by)
  values (new.id, new.status, auth.uid());
  return new;
end;
$$;

create or replace function public.log_production_status_on_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into public.production_stage_events (production_order_id, status, changed_by)
    values (new.id, new.status, auth.uid());
  end if;
  return new;
end;
$$;

create trigger production_orders_log_status_insert
  after insert on public.production_orders
  for each row execute function public.log_production_status_on_insert();

create trigger production_orders_log_status_update
  after update of status on public.production_orders
  for each row execute function public.log_production_status_on_update();

-- Finishes a production order: the correct quantity goes into stock as a
-- real movement, the rejected quantity is recorded but never hidden
-- (sección 28 — "nunca ocultar diferencias").
create or replace function public.complete_production_order(
  p_id uuid,
  p_produced_quantity integer,
  p_rejected_quantity integer
)
returns void
language plpgsql
security invoker
as $$
declare
  v_order public.production_orders%rowtype;
  v_inventory_item_id uuid;
begin
  select * into v_order from public.production_orders where id = p_id for update;
  if v_order.id is null then
    raise exception 'Orden de producción no encontrada.';
  end if;
  if v_order.status in ('done', 'cancelled') then
    raise exception 'Esta orden ya está %.', v_order.status;
  end if;
  if p_produced_quantity < 0 or p_rejected_quantity < 0 then
    raise exception 'Las cantidades no pueden ser negativas.';
  end if;

  select id into v_inventory_item_id
  from public.inventory_items where product_variant_id = v_order.product_variant_id;

  if p_produced_quantity > 0 then
    insert into public.inventory_movements
      (inventory_item_id, location_id, movement_type, quantity, reference_table, reference_id, created_by)
    values
      (v_inventory_item_id, v_order.location_id, 'production_in', p_produced_quantity, 'production_orders', p_id, auth.uid());
  end if;

  update public.production_orders
  set produced_quantity = p_produced_quantity,
      rejected_quantity = p_rejected_quantity,
      status = 'done',
      completed_at = now()
  where id = p_id;
end;
$$;

grant execute on function public.complete_production_order to authenticated;

-- ============================================================================
-- set_order_status — extends the Fase 4 version: confirming now reserves
-- only what's actually available and raises a production_order for the
-- rest, instead of silently reserving the full requested quantity.
-- ============================================================================

create or replace function public.set_order_status(p_order_id uuid, p_new_status public.order_status)
returns void
language plpgsql
security invoker
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
  v_available integer;
  v_reserve_qty integer;
  v_shortfall integer;
  v_business_unit_code text;
  v_origin public.production_origin;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'Pedido no encontrado.';
  end if;

  if p_new_status = 'confirmed' and v_order.status = 'pending' then
    if v_order.location_id is null then
      raise exception 'Elegí una ubicación para el pedido antes de confirmarlo.';
    end if;

    select code into v_business_unit_code
    from public.business_units where id = v_order.business_unit_id;

    v_origin := case v_business_unit_code
      when 'retail' then 'retail_order'
      when 'wholesale' then 'wholesale_order'
      when 'custom' then 'custom_order'
      else 'restock'
    end;

    for v_item in
      select oi.product_variant_id, oi.quantity, ii.id as inventory_item_id
      from public.order_items oi
      join public.inventory_items ii on ii.product_variant_id = oi.product_variant_id
      where oi.order_id = p_order_id
    loop
      select coalesce(sum(m.quantity), 0)::integer into v_available
      from public.inventory_movements m
      where m.inventory_item_id = v_item.inventory_item_id and m.location_id = v_order.location_id;

      v_available := v_available - coalesce((
        select sum(r.quantity)::integer from public.inventory_reservations r
        where r.inventory_item_id = v_item.inventory_item_id
          and r.location_id = v_order.location_id and r.status = 'active'
      ), 0);

      v_reserve_qty := least(v_item.quantity, greatest(0, v_available));
      v_shortfall := v_item.quantity - v_reserve_qty;

      if v_reserve_qty > 0 then
        insert into public.inventory_reservations
          (inventory_item_id, location_id, order_id, quantity, status)
        values
          (v_item.inventory_item_id, v_order.location_id, p_order_id, v_reserve_qty, 'active');
      end if;

      if v_shortfall > 0 then
        insert into public.production_orders
          (origin, order_id, product_variant_id, location_id, quantity, notes)
        values
          (v_origin, p_order_id, v_item.product_variant_id, v_order.location_id, v_shortfall,
           'Generada automáticamente al confirmar ' || v_order.human_code);
      end if;
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

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.production_orders enable row level security;
alter table public.production_stage_events enable row level security;

create policy "production_orders_select_authenticated"
  on public.production_orders for select to authenticated using (true);
create policy "production_orders_write_operations"
  on public.production_orders for all to authenticated
  using (public.is_operations_or_owner()) with check (public.is_operations_or_owner());

create policy "production_stage_events_select_authenticated"
  on public.production_stage_events for select to authenticated using (true);
