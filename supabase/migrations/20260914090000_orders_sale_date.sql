-- orders.sale_date (Bloque 2 — "Ventas: fecha real, canal, comisiones y
-- talleres"). Fecha comercial declarada, distinta de created_at (carga)
-- y de sold_at (transición técnica a delivered, sin cambios — sigue
-- existiendo, sigue siendo obra exclusiva del trigger orders_set_sold_at,
-- nunca editable). `date`, no timestamptz: es un día que la usuaria
-- elige en un calendario, nunca un instante — mismo criterio que
-- orders.estimated_date y calendar_reminders.remind_at, las dos únicas
-- fechas "declaradas" que ya existían en el esquema.

alter table public.orders
  add column sale_date date,
  add column sale_date_declared boolean not null default true;

-- Backfill histórico — NUNCA presentado como una fecha declarada por la
-- usuaria. coalesce(sold_at, created_at) es la mejor evidencia
-- disponible, no una reconstrucción de la verdad comercial: para una
-- venta cargada retroactivamente sin ningún registro de la fecha real
-- (ej. vendida el 10/09, cargada y entregada el 13/09), esa fecha real
-- ya no existe en ningún lado — inventarla sería mentir. Por eso
-- sale_date_declared queda explícitamente en false para todo lo
-- backfilleado: nunca se confunde con algo que la usuaria haya
-- tecleado. Casteo en huso horario Argentina — nunca UTC, que puede
-- correr la fecha un día.
update public.orders
set sale_date = coalesce(
      (sold_at at time zone 'America/Argentina/Buenos_Aires')::date,
      (created_at at time zone 'America/Argentina/Buenos_Aires')::date
    ),
    sale_date_declared = false
where sale_date is null;

alter table public.orders alter column sale_date set not null;
-- Red de seguridad — la app siempre manda un valor explícito (hoy en
-- fecha argentina si la usuaria no la edita), esto sólo cubre un insert
-- que por error no lo mande.
alter table public.orders alter column sale_date set default ((now() at time zone 'America/Argentina/Buenos_Aires')::date);

create index orders_sale_date_idx on public.orders (sale_date);

-- ============================================================================
-- create_order gana p_sale_date opcional (nunca lo pide la UI de
-- Pedidos todavía — cae al default de hoy, igual que su comportamiento
-- actual). `drop function` primero: agregar un parámetro con
-- `create or replace` deja la firma vieja como un segundo overload
-- ambiguo en vez de reemplazarla (mismo problema ya encontrado y
-- corregido en el Bloque 3 de precios).
-- ============================================================================

drop function if exists public.create_order(
  uuid, uuid, uuid, uuid, uuid, text, text, date, text, jsonb
);

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
  p_items jsonb,
  p_sale_date date default null
)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_order_id uuid;
  v_item jsonb;
  v_variant_id uuid;
  v_custom_name text;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido necesita al menos un producto.';
  end if;

  insert into public.orders (
    business_unit_id, customer_id, location_id, origin_channel_id,
    closing_channel_id, delivery_method, delivery_address, estimated_date,
    notes, operation_type, sale_date, sale_date_declared, created_by
  ) values (
    p_business_unit_id, p_customer_id, p_location_id, p_origin_channel_id,
    p_closing_channel_id, p_delivery_method, p_delivery_address, p_estimated_date,
    p_notes, 'order',
    coalesce(p_sale_date, (now() at time zone 'America/Argentina/Buenos_Aires')::date),
    true,
    auth.uid()
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_variant_id := (v_item ->> 'product_variant_id')::uuid;
    v_custom_name := nullif(trim(v_item ->> 'custom_name'), '');

    if v_variant_id is null and v_custom_name is null then
      raise exception 'Cada ítem necesita un producto del catálogo o un nombre.';
    end if;

    insert into public.order_items (order_id, product_variant_id, quantity, unit_price, custom_name, custom_description)
    values (
      v_order_id,
      v_variant_id,
      (v_item ->> 'quantity')::integer,
      (v_item ->> 'unit_price')::numeric,
      v_custom_name,
      nullif(trim(v_item ->> 'custom_description'), '')
    );
  end loop;

  return v_order_id;
end;
$$;

-- ============================================================================
-- create_quick_retail_sale gana p_sale_date opcional — la UI de venta
-- rápida SÍ lo expone (default hoy, editable). Mismo cuerpo que la
-- migración anterior (20260913000000_price_conditions.sql), sólo se
-- agrega el parámetro y el insert de sale_date/sale_date_declared.
-- ============================================================================

drop function if exists public.create_quick_retail_sale(
  uuid, jsonb, uuid, timestamptz, uuid, uuid, uuid, numeric, uuid, uuid
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
  p_sale_date date default null
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

  insert into public.payments (order_id, amount, method_id, account_id, paid_at, created_by)
  values (v_order_id, v_final_total, p_payment_method_id, p_payment_account_id, p_paid_at, auth.uid());

  return query select v_order_id, v_human_code, v_final_total;
end;
$$;
