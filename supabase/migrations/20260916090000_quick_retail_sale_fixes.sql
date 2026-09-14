-- Dos correcciones a create_quick_retail_sale encontradas en la revisión
-- de producción previa al merge de Bloque 3 (PR #26) — ninguna cambia su
-- firma, así que esto reemplaza el cuerpo sin necesidad de `drop
-- function` primero.
--
-- 1) Ítems duplicados en p_items: el backend consolidaba cada aparición
--    de la misma variante como una fila independiente en la tabla
--    temporal, y la validaba contra el stock disponible por separado.
--    Enviar la misma variante dos veces (algo que la UI de hoy no hace,
--    pero que el RPC nunca debe asumir) podía pasar la validación de
--    stock dos veces contra el mismo disponible y terminar en stock
--    negativo. Ahora se consolida por variante ANTES de validar stock,
--    nunca se depende de que el frontend ya mande las líneas agrupadas.
-- 2) Condición de precio vs. método de pago: el RPC validaba que la
--    condición de precio existiera y estuviera activa, pero nunca que
--    el método de pago elegido estuviera habilitado para ESA condición
--    (price_condition_payment_methods) — permitía, por ejemplo, cobrar
--    con Tarjeta bajo una condición pensada sólo para Efectivo. Se
--    valida ahora, antes de tocar stock o insertar nada.

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

  -- Fix 2: la combinación condición + método tiene que existir y estar
  -- habilitada en price_condition_payment_methods. Nunca se confía en
  -- que la UI sólo ofrezca combinaciones válidas.
  if not exists (
    select 1 from public.price_condition_payment_methods pcpm
    where pcpm.price_condition_id = p_price_condition_id
      and pcpm.payment_method_id = p_payment_method_id
  ) then
    raise exception 'La forma de pago elegida no está habilitada para la condición de precio seleccionada.';
  end if;

  drop table if exists tmp_sale_items_raw;
  create temporary table tmp_sale_items_raw (
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

    insert into tmp_sale_items_raw (inventory_item_id, product_variant_id, quantity, unit_price, product_label)
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

  -- Fix 1: consolidar por variante ANTES de validar stock — nunca
  -- depender de que el frontend ya mande las líneas agrupadas. La
  -- cantidad requerida total de una variante es la suma de todas sus
  -- apariciones en p_items.
  drop table if exists tmp_sale_items;
  create temporary table tmp_sale_items (
    inventory_item_id uuid not null,
    product_variant_id uuid not null,
    quantity numeric not null,
    unit_price numeric not null,
    product_label text not null
  ) on commit drop;

  insert into tmp_sale_items (inventory_item_id, product_variant_id, quantity, unit_price, product_label)
  select inventory_item_id, product_variant_id, sum(quantity), max(unit_price), max(product_label)
  from tmp_sale_items_raw
  group by inventory_item_id, product_variant_id;

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
