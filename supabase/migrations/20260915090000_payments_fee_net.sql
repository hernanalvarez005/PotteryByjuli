-- payments.fee_amount / net_amount (Bloque 3 — "Ventas: fecha real,
-- canal, comisiones y talleres"). El precio que paga la clienta
-- (price_condition) y el costo de procesar el cobro (fee del método/
-- cuenta) son dos cosas distintas — un descuento comercial nunca es lo
-- mismo que la comisión que se lleva la tarjeta. Por eso el fee vive
-- acá, en `payments`, nunca en `price_conditions` ni en `orders`.

alter table public.payments
  add column fee_amount numeric(12,2) not null default 0,
  -- Generated, no insertable: nadie —ni el frontend, ni un bug futuro—
  -- puede forzar un neto arbitrario. El neto siempre se deriva de
  -- amount y fee_amount, nunca se guarda como un valor independiente.
  add column net_amount numeric(12,2) generated always as (amount - fee_amount) stored;

alter table public.payments
  add constraint payments_fee_amount_range check (fee_amount >= 0 and fee_amount <= amount);

-- ============================================================================
-- payment_method_fee_suggestions: % de comisión sugerido para mostrar en
-- la venta rápida antes de cobrar (nunca lo que se guarda — eso siempre
-- lo confirma/corrige la usuaria como fee_amount real en el pago). Dos
-- reglas de unicidad distintas conviven acá, por eso son dos índices
-- parciales en vez de un solo `unique` (que además no alcanzaría:
-- `unique(payment_method_id, account_id)` no bloquea filas repetidas
-- cuando account_id es NULL en Postgres estándar):
--   - genérica por método (account_id is null): un único sugerido "por
--     default" para ese método, sin importar la cuenta.
--   - específica por método+cuenta (account_id is not null): permite
--     una sugerencia más precisa cuando el costo real varía según la
--     cuenta (ej. "Tarjeta" vía Mercado Pago vs. vía POS del banco).
-- ============================================================================

create table public.payment_method_fee_suggestions (
  id uuid primary key default gen_random_uuid(),
  payment_method_id uuid not null references public.payment_methods(id) on delete cascade,
  account_id uuid references public.payment_accounts(id) on delete cascade,
  suggested_percentage numeric(5,2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_method_fee_suggestions_percentage_range
    check (suggested_percentage >= 0 and suggested_percentage <= 100)
);

create unique index payment_method_fee_suggestions_generic_key
  on public.payment_method_fee_suggestions (payment_method_id)
  where account_id is null;

create unique index payment_method_fee_suggestions_specific_key
  on public.payment_method_fee_suggestions (payment_method_id, account_id)
  where account_id is not null;

alter table public.payment_method_fee_suggestions enable row level security;

create policy payment_method_fee_suggestions_select_authenticated
  on public.payment_method_fee_suggestions
  for select to authenticated using (true);

create policy payment_method_fee_suggestions_write_owner
  on public.payment_method_fee_suggestions
  for all to authenticated using (is_owner()) with check (is_owner());

create trigger set_payment_method_fee_suggestions_updated_at
  before update on public.payment_method_fee_suggestions
  for each row execute function public.set_updated_at();

-- ============================================================================
-- log_payment_correction() gana fee_amount entre las columnas
-- auditadas — sin esto, corregir una comisión mal cargada no dejaría
-- ningún rastro, rompiendo la garantía de auditoría que ya vale para
-- amount/paid_at/method_id/account_id/reference/notes.
-- ============================================================================

create or replace function public.log_payment_correction()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.amount is distinct from old.amount
     or new.paid_at is distinct from old.paid_at
     or new.method_id is distinct from old.method_id
     or new.account_id is distinct from old.account_id
     or new.reference is distinct from old.reference
     or new.notes is distinct from old.notes
     or new.fee_amount is distinct from old.fee_amount
  then
    insert into public.payment_corrections (payment_id, changed_by, previous_values, new_values)
    values (
      new.id,
      auth.uid(),
      jsonb_build_object(
        'amount', old.amount, 'paid_at', old.paid_at, 'method_id', old.method_id,
        'account_id', old.account_id, 'reference', old.reference, 'notes', old.notes,
        'fee_amount', old.fee_amount
      ),
      jsonb_build_object(
        'amount', new.amount, 'paid_at', new.paid_at, 'method_id', new.method_id,
        'account_id', new.account_id, 'reference', new.reference, 'notes', new.notes,
        'fee_amount', new.fee_amount
      )
    );
  end if;
  return new;
end;
$$;

-- ============================================================================
-- create_quick_retail_sale gana p_fee_amount opcional (default 0 —
-- efectivo y cualquier venta que no lo edite queda con comisión cero).
-- Nunca recibe un p_net_amount: el neto sale solo de la columna
-- generada. `drop function` primero — agregar un parámetro con
-- `create or replace` deja la firma vieja como un overload ambiguo.
-- ============================================================================

drop function if exists public.create_quick_retail_sale(
  uuid, jsonb, uuid, timestamptz, uuid, uuid, uuid, numeric, uuid, uuid, date
);

create or replace function public.create_quick_retail_sale(
  p_location_id uuid,
  p_items jsonb,
  p_payment_method_id uuid,
  p_paid_at timestamptz,
  p_customer_id uuid default null,
  p_channel_id uuid default null,
  p_payment_account_id uuid default null,
  p_discount_total numeric default 0,
  p_client_request_id uuid default null,
  p_price_condition_id uuid default null,
  p_sale_date date default null,
  p_fee_amount numeric default 0
)
returns table(order_id uuid, human_code text, total numeric)
language plpgsql
security invoker
as $$
declare
  v_business_unit_id uuid;
  v_channel_id uuid;
  v_price_list_id uuid;
  v_order_id uuid;
  v_human_code text;
  v_final_total numeric;
  v_subtotal numeric := 0;
  v_item jsonb;
  v_variant_id uuid;
  v_quantity numeric;
  v_available numeric;
begin
  if p_client_request_id is not null then
    select o.id, o.human_code, o.total
    into v_order_id, v_human_code, v_final_total
    from public.orders o
    where o.client_request_id = p_client_request_id;

    if v_order_id is not null then
      return query select v_order_id, v_human_code, v_final_total;
      return;
    end if;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta necesita al menos un producto.';
  end if;

  select id into v_business_unit_id from public.business_units where code = 'retail';
  if v_business_unit_id is null then
    raise exception 'No se encontró la unidad de negocio minorista.';
  end if;

  v_channel_id := p_channel_id;
  if v_channel_id is null then
    select id into v_channel_id from public.sales_channels where code = 'in_person';
  end if;

  if p_price_condition_id is null then
    raise exception 'Se necesita elegir una condición de precio.';
  end if;

  select price_list_id into v_price_list_id
  from public.price_conditions
  where id = p_price_condition_id and is_active;

  if v_price_list_id is null then
    raise exception 'La condición de precio elegida no existe o ya no está activa.';
  end if;

  drop table if exists tmp_sale_items;
  create temporary table tmp_sale_items (
    inventory_item_id uuid not null,
    product_variant_id uuid not null,
    quantity numeric not null,
    unit_price numeric not null,
    product_label text not null
  ) on commit drop;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_variant_id := (v_item ->> 'product_variant_id')::uuid;
    v_quantity := (v_item ->> 'quantity')::numeric;

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Cantidad inválida.';
    end if;

    insert into tmp_sale_items (inventory_item_id, product_variant_id, quantity, unit_price, product_label)
    select
      ii.id,
      pv.id,
      v_quantity,
      pli.unit_price,
      case when pv.name = 'Único' then p.name else p.name || ' — ' || pv.name end
    from public.product_variants pv
    join public.products p on p.id = pv.product_id
    join public.inventory_items ii on ii.product_variant_id = pv.id
    join public.price_list_items pli
      on pli.product_variant_id = pv.id and pli.price_list_id = v_price_list_id
    where pv.id = v_variant_id and pv.is_active and p.is_active;

    if not found then
      raise exception 'Uno de los productos no está disponible o no tiene precio cargado para la condición elegida.';
    end if;
  end loop;

  select coalesce(sum(quantity * unit_price), 0) into v_subtotal from tmp_sale_items;

  if p_discount_total < 0 or p_discount_total > v_subtotal then
    raise exception 'Descuento inválido.';
  end if;

  for v_variant_id, v_quantity, v_available in
    select t.inventory_item_id, t.quantity, null::numeric
    from tmp_sale_items t
    order by t.inventory_item_id
  loop
    perform pg_advisory_xact_lock(hashtext(v_variant_id::text), hashtext(p_location_id::text));

    select coalesce(sum(m.quantity), 0) into v_available
    from public.inventory_movements m
    where m.inventory_item_id = v_variant_id and m.location_id = p_location_id;

    v_available := v_available - coalesce((
      select sum(r.quantity) from public.inventory_reservations r
      where r.inventory_item_id = v_variant_id and r.location_id = p_location_id and r.status = 'active'
    ), 0);

    if v_quantity > v_available then
      raise exception 'No hay stock suficiente de %. Disponible en %: %.',
        (select product_label from tmp_sale_items where inventory_item_id = v_variant_id limit 1),
        (select name from public.locations where id = p_location_id),
        greatest(0, v_available);
    end if;
  end loop;

  insert into public.orders (
    business_unit_id, customer_id, location_id, origin_channel_id, closing_channel_id,
    status, discount_total, client_request_id, operation_type, price_condition_id,
    sale_date, sale_date_declared, created_by
  ) values (
    v_business_unit_id, p_customer_id, p_location_id, v_channel_id, v_channel_id,
    'delivered', p_discount_total, p_client_request_id, 'retail_sale', p_price_condition_id,
    coalesce(p_sale_date, (now() at time zone 'America/Argentina/Buenos_Aires')::date),
    true,
    auth.uid()
  )
  returning orders.id, orders.human_code into v_order_id, v_human_code;

  insert into public.order_items (order_id, product_variant_id, quantity, unit_price)
  select v_order_id, product_variant_id, quantity, unit_price from tmp_sale_items;

  select o.total into v_final_total from public.orders o where o.id = v_order_id;

  insert into public.inventory_movements (inventory_item_id, location_id, movement_type, quantity, reference_table, reference_id, created_by)
  select inventory_item_id, p_location_id, 'sale', -quantity, 'orders', v_order_id, auth.uid()
  from tmp_sale_items;

  if p_fee_amount < 0 or p_fee_amount > v_final_total then
    raise exception 'La comisión no puede ser negativa ni mayor al total cobrado.';
  end if;

  insert into public.payments (order_id, amount, fee_amount, method_id, account_id, paid_at, created_by)
  values (v_order_id, v_final_total, p_fee_amount, p_payment_method_id, p_payment_account_id, p_paid_at, auth.uid());

  return query select v_order_id, v_human_code, v_final_total;
end;
$$;
