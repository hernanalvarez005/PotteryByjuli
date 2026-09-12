-- Condiciones de precio + motor de cotización (Bloque 3 — "Próxima
-- evolución operativa de Pottery"). Ver auditoría, sección D: la fuente
-- de verdad del precio sigue siendo price_list_items.unit_price — una
-- condición de precio es sólo una price_list más (mismo mecanismo ya
-- probado con retail/wholesale), nunca una tabla de precios paralela.
-- Deliberadamente NO es una promoción ni un descuento automático: cada
-- condición tiene su propio precio final por variante, cargado a mano.

create table public.price_conditions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  price_list_id uuid not null references public.price_lists (id),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Puente muchos a muchos: una condición puede aceptar más de un método de
-- pago, y un método puede en teoría habilitar más de una condición. El
-- caso típico es 1 a 1, pero el modelo no lo asume (ver D.2).
create table public.price_condition_payment_methods (
  price_condition_id uuid not null references public.price_conditions (id) on delete cascade,
  payment_method_id uuid not null references public.payment_methods (id) on delete cascade,
  primary key (price_condition_id, payment_method_id)
);

create index price_conditions_price_list_id_idx on public.price_conditions (price_list_id);

alter table public.price_conditions enable row level security;
alter table public.price_condition_payment_methods enable row level security;

-- Mismo patrón ya usado para price_lists/price_list_items (Fase 2):
-- lectura para cualquier autenticado, escritura sólo para la dueña.
do $$
declare
  t text;
begin
  foreach t in array array['price_conditions', 'price_condition_payment_methods']
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
-- orders.price_condition_id — qué precio comercial se aplicó. Describe
-- CÓMO se cotizó una operación, nunca QUÉ TIPO de operación es (eso es
-- operation_type, Bloque 2) — un pedido tradicional podría algún día
-- usar una condición de precio también. Nullable: ventas hechas antes de
-- este bloque, y cualquier pedido que no pase por este mecanismo, quedan
-- sin condición — nunca se les inventa una retroactivamente.
-- ============================================================================

alter table public.orders
  add column price_condition_id uuid references public.price_conditions (id);

-- ============================================================================
-- Seed: una única condición inicial que preserva EXACTAMENTE el
-- comportamiento de hoy — mismo precio (la price_list 'retail' de
-- siempre, sin crear una lista nueva ni copiar precios), aceptando
-- cualquier método de pago activo, tal como la venta rápida funciona
-- antes de este bloque. Juli puede crear condiciones diferenciadas
-- después desde /precios (cada una con su propia price_list, para poder
-- cargarle un precio distinto) — este seed no le adivina esa decisión
-- de negocio, sólo evita romper la venta rápida ya en uso.
-- ============================================================================

insert into public.price_conditions (code, name, price_list_id, sort_order)
select 'general', 'Precio de lista', pl.id, 0
from public.price_lists pl
where pl.code = 'retail';

insert into public.price_condition_payment_methods (price_condition_id, payment_method_id)
select pc.id, pm.id
from public.price_conditions pc
cross join public.payment_methods pm
where pc.code = 'general';

-- ============================================================================
-- quote_retail_sale — cotización de sólo lectura. Nunca inserta, nunca
-- bloquea stock. Por cada condición activa, resuelve el precio de cada
-- ítem del carrito en su price_list correspondiente; si a algún ítem le
-- falta precio bajo una condición, esa condición se excluye del
-- resultado — nunca cae toda la cotización, nunca inventa un precio
-- (mismo criterio que "no disponible para mayorista" en /mayorista hoy).
-- El frontend nunca calcula: sólo pinta las cards con lo que esto
-- devuelve.
-- ============================================================================

create or replace function public.quote_retail_sale(p_items jsonb)
returns table(
  price_condition_id uuid,
  price_condition_name text,
  subtotal numeric,
  adjustments numeric,
  total numeric
)
language plpgsql
security invoker
as $$
declare
  v_condition record;
  v_item jsonb;
  v_variant_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_subtotal numeric;
  v_missing boolean;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    return;
  end if;

  for v_condition in
    select pc.id, pc.name, pc.price_list_id
    from public.price_conditions pc
    where pc.is_active
    order by pc.sort_order, pc.name
  loop
    v_subtotal := 0;
    v_missing := false;

    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_variant_id := (v_item ->> 'product_variant_id')::uuid;
      v_quantity := (v_item ->> 'quantity')::numeric;

      select pli.unit_price into v_unit_price
      from public.price_list_items pli
      where pli.price_list_id = v_condition.price_list_id
        and pli.product_variant_id = v_variant_id;

      if v_unit_price is null then
        v_missing := true;
        exit;
      end if;

      v_subtotal := v_subtotal + v_quantity * v_unit_price;
    end loop;

    if not v_missing then
      price_condition_id := v_condition.id;
      price_condition_name := v_condition.name;
      subtotal := v_subtotal;
      -- Reservado para un ajuste manual futuro — hoy siempre 0. El total
      -- de cada card es exactamente el subtotal resuelto, nunca un
      -- cálculo aparte.
      adjustments := 0;
      total := v_subtotal + adjustments;
      return next;
    end if;
  end loop;

  return;
end;
$$;

grant execute on function public.quote_retail_sale to authenticated;

-- ============================================================================
-- create_price_condition — atómico: crea la price_list dedicada, la
-- condición, y sus métodos de pago aceptados en un solo paso. RLS en las
-- tres tablas ya restringe la escritura a la dueña (security invoker) —
-- esta función no repite ese chequeo, confía en las policies.
-- ============================================================================

create or replace function public.create_price_condition(
  p_code text,
  p_name text,
  p_payment_method_ids uuid[]
)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_price_list_id uuid;
  v_condition_id uuid;
begin
  if p_code is null or trim(p_code) = '' or p_name is null or trim(p_name) = '' then
    raise exception 'Nombre y código son obligatorios.';
  end if;

  if exists (select 1 from public.price_lists where code = p_code) then
    raise exception 'Ya existe una lista de precios con ese código.';
  end if;
  if exists (select 1 from public.price_conditions where code = p_code) then
    raise exception 'Ya existe una condición de precio con ese código.';
  end if;

  insert into public.price_lists (code, name) values (p_code, p_name)
  returning id into v_price_list_id;

  insert into public.price_conditions (code, name, price_list_id)
  values (p_code, p_name, v_price_list_id)
  returning id into v_condition_id;

  if p_payment_method_ids is not null and array_length(p_payment_method_ids, 1) > 0 then
    insert into public.price_condition_payment_methods (price_condition_id, payment_method_id)
    select v_condition_id, unnest(p_payment_method_ids);
  end if;

  return v_condition_id;
end;
$$;

grant execute on function public.create_price_condition to authenticated;

-- ============================================================================
-- create_quick_retail_sale — gana p_price_condition_id, reemplaza el
-- code='retail' hardcodeado de antes. Sigue resolviendo el precio él
-- mismo contra price_list_items (nunca confía en el total que cotizó
-- quote_retail_sale segundos antes, ni en nada que mande el cliente) —
-- mismo cuerpo que la migración anterior (20260912210000), sólo cambia
-- cómo se resuelve la price_list y se agrega price_condition_id al
-- insert de orders.
--
-- `create or replace function` NO alcanza acá: agregar un parámetro
-- nuevo cambia la firma, así que Postgres lo trataría como un overload
-- adicional en vez de reemplazar el existente, dejando las dos versiones
-- activas (ambiguas para cualquier llamada con 9 argumentos). Hay que
-- borrar la firma vieja explícitamente primero.
-- ============================================================================

drop function if exists public.create_quick_retail_sale(
  uuid, jsonb, uuid, timestamptz, uuid, uuid, uuid, numeric, uuid
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
  p_price_condition_id uuid default null
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

  if p_price_condition_id is null then
    raise exception 'Se necesita elegir una condición de precio.';
  end if;

  select price_list_id into v_price_list_id
  from public.price_conditions
  where id = p_price_condition_id and is_active;

  if v_price_list_id is null then
    raise exception 'La condición de precio elegida no existe o ya no está activa.';
  end if;

  -- 1. Resolver cada ítem: variante real y activa, inventory_item
  -- correspondiente, y el precio vigente bajo la condición elegida —
  -- nunca el que venga (si viniera) en el jsonb del cliente. Se guardan
  -- en una tabla temporal ordenada por inventory_item_id (orden
  -- determinístico para el locking del paso 3).
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
    status, discount_total, client_request_id, operation_type, price_condition_id, created_by
  ) values (
    v_business_unit_id, p_customer_id, p_location_id, v_channel_id, v_channel_id,
    'delivered', p_discount_total, p_client_request_id, 'retail_sale', p_price_condition_id, auth.uid()
  )
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
