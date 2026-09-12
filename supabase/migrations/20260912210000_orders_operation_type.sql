-- orders.operation_type — distingue QUÉ operación es un pedido (venta
-- minorista inmediata vs. encargo/pedido a producir). Deliberadamente
-- una columna propia, independiente de:
--   - business_unit_id (a qué unidad de negocio pertenece)
--   - price_condition_id (qué precio comercial se aplicó — todavía no
--     existe, Bloque 3)
--   - payments.method_id (cómo pagó)
--   - closing_channel_id (dónde se concretó)
-- Un pedido a medida podría algún día usar una price_condition, así que
-- "tiene price_condition_id" nunca puede ser el criterio de "es una
-- venta" — de ahí esta columna dedicada. Ver auditoría "Próxima
-- evolución operativa de Pottery", corrección 2.
--
-- Sin backfill histórico: no hay ninguna señal confiable para
-- reclasificar pedidos ya creados — ni siquiera las ventas rápidas
-- hechas hasta ahora se distinguen de un pedido común entregado el
-- mismo día sin inspeccionar caso por caso. Todo lo existente queda en
-- 'order' por default; sólo las nuevas filas se marcan explícitamente
-- desde acá en adelante.

alter table public.orders
  add column operation_type text not null default 'order'
  check (operation_type in ('order', 'retail_sale'));

create index orders_operation_type_idx on public.orders (operation_type);

-- ============================================================================
-- create_order — siempre crea 'order' (encargo/pedido a producir).
-- Cuerpo idéntico al existente (migración 20260912150201), sólo se agrega
-- operation_type al insert.
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
  v_variant_id uuid;
  v_custom_name text;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido necesita al menos un producto.';
  end if;

  insert into public.orders (
    business_unit_id, customer_id, location_id, origin_channel_id,
    closing_channel_id, delivery_method, delivery_address, estimated_date,
    notes, operation_type, created_by
  ) values (
    p_business_unit_id, p_customer_id, p_location_id, p_origin_channel_id,
    p_closing_channel_id, p_delivery_method, p_delivery_address, p_estimated_date,
    p_notes, 'order', auth.uid()
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
-- create_quick_retail_sale — siempre crea 'retail_sale'. Cuerpo idéntico
-- al existente (migración 20260911132411), sólo se agrega operation_type
-- al insert.
-- ============================================================================

create or replace function public.create_quick_retail_sale(
  p_location_id uuid,
  p_items jsonb,
  p_payment_method_id uuid,
  p_paid_at timestamptz,
  p_customer_id uuid default null,
  p_channel_id uuid default null,
  p_payment_account_id uuid default null,
  p_discount_total numeric default 0,
  p_client_request_id uuid default null
)
returns table(order_id uuid, human_code text, total numeric)
language plpgsql
security invoker
as $$
declare
  v_business_unit_id uuid;
  v_channel_id uuid;
  v_retail_list_id uuid;
  v_order_id uuid;
  v_human_code text;
  v_final_total numeric;
  v_subtotal numeric := 0;
  v_item jsonb;
  v_variant_id uuid;
  v_quantity numeric;
  v_available numeric;
begin
  -- 0. Idempotencia primero — antes de tomar cualquier lock o insertar
  -- nada. Un doble click/retry con el mismo client_request_id nunca
  -- vuelve a tocar stock ni pagos, sólo devuelve lo que ya existe.
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

  select id into v_retail_list_id from public.price_lists where code = 'retail';
  if v_retail_list_id is null then
    raise exception 'No se encontró la lista de precios minorista.';
  end if;

  -- 1. Resolver cada ítem: variante real y activa, inventory_item
  -- correspondiente, y el precio minorista vigente — nunca el que
  -- venga (si viniera) en el jsonb del cliente. Se guardan en una
  -- tabla temporal ordenada por inventory_item_id (orden determinístico
  -- para el locking del paso 3).
  -- drop if exists: si esta llamada corre dentro de una transacción que ya
  -- invocó la función antes (p.ej. tests), "on commit drop" todavía no
  -- liberó la tabla de la llamada anterior — nunca debería pasar en el uso
  -- real (cada RPC es su propia transacción), pero es gratis blindarlo.
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
      on pli.product_variant_id = pv.id and pli.price_list_id = v_retail_list_id
    where pv.id = v_variant_id and pv.is_active and p.is_active;

    if not found then
      raise exception 'Uno de los productos no está disponible o no tiene precio minorista cargado.';
    end if;
  end loop;

  select coalesce(sum(quantity * unit_price), 0) into v_subtotal from tmp_sale_items;

  if p_discount_total < 0 or p_discount_total > v_subtotal then
    raise exception 'Descuento inválido.';
  end if;

  -- 2. Validar stock disponible, con el lock tomado ANTES de leer
  -- disponible — nunca "calcular → hacer otra cosa → insertar" con una
  -- ventana abierta en el medio. Orden determinístico
  -- (inventory_item_id asc, ya viene de la tabla temporal) para evitar
  -- deadlock entre dos ventas con los mismos productos.
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

  -- 3. Crear el pedido ya "delivered" — una venta inmediata no pasa por
  -- confirmed/reservas, el cliente se lleva el producto en el momento.
  insert into public.orders (
    business_unit_id, customer_id, location_id, origin_channel_id, closing_channel_id,
    status, discount_total, client_request_id, operation_type, created_by
  ) values (
    v_business_unit_id, p_customer_id, p_location_id, v_channel_id, v_channel_id,
    'delivered', p_discount_total, p_client_request_id, 'retail_sale', auth.uid()
  )
  -- Calificado con el alias de la tabla: el nombre de salida de la
  -- función (human_code, total) es también una variable plpgsql en este
  -- scope, y sin calificar Postgres no sabe si "human_code"/"total" se
  -- refiere a la columna de la tabla o a esa variable de salida.
  returning orders.id, orders.human_code into v_order_id, v_human_code;

  insert into public.order_items (order_id, product_variant_id, quantity, unit_price)
  select v_order_id, product_variant_id, quantity, unit_price from tmp_sale_items;

  -- El trigger recalculate_order_totals (Fase 3) ya recalculó
  -- subtotal/total al insertar los order_items — se lee de vuelta en
  -- vez de calcularlo acá en paralelo, así el pago siempre coincide con
  -- lo que el trigger existente produjo.
  select o.total into v_final_total from public.orders o where o.id = v_order_id;

  insert into public.inventory_movements (inventory_item_id, location_id, movement_type, quantity, reference_table, reference_id, created_by)
  select inventory_item_id, p_location_id, 'sale', -quantity, 'orders', v_order_id, auth.uid()
  from tmp_sale_items;

  insert into public.payments (order_id, amount, method_id, account_id, paid_at, created_by)
  values (v_order_id, v_final_total, p_payment_method_id, p_payment_account_id, p_paid_at, auth.uid());

  return query select v_order_id, v_human_code, v_final_total;
end;
$$;
