-- Extensión del checkout mayorista: datos completos del comprador, dedup
-- con detección de conflicto, snapshot histórico para el PDF, canal de
-- origen dedicado, y el timestamp de "se abrió WhatsApp" (nunca "enviado").
-- Ver docs/business-rules.md § Checkout mayorista para el detalle de cada
-- regla.

-- ============================================================================
-- Columnas nuevas
-- ============================================================================

alter table public.customers
  add column address text,
  add column postal_code text;

alter table public.orders
  add column whatsapp_share_opened_at timestamptz,
  -- Datos del comprador tal como se enviaron en ESTA solicitud puntual —
  -- nunca un join en vivo a `customers`, porque esa fila puede cambiar
  -- después (otro pedido, un merge fill-null-only, una edición manual en
  -- el CRM). El PDF debe representar lo que el comprador vio/escribió al
  -- momento de pedir, no el estado actual del cliente.
  add column wholesale_buyer_snapshot jsonb;

alter table public.wholesale_settings
  add column business_whatsapp text;

alter table public.order_attachments
  add column kind text;

insert into public.sales_channels (code, name, sort_order) values
  ('web_mayorista', 'Catálogo web mayorista', 8)
on conflict (code) do nothing;

-- ============================================================================
-- Conflictos de identidad al deduplicar clientes
--
-- Si las señales (whatsapp normalizado / email / CUIT) de una nueva
-- solicitud apuntan a customers YA EXISTENTES pero DISTINTOS entre sí, no
-- se fusiona nada automáticamente (podría mezclar dos personas/comercios
-- reales) ni se pierde el pedido: se crea un customer nuevo para esa
-- solicitud puntual y queda registrado acá para revisión manual. No hace
-- falta una columna en `customers` para "marcar" ese customer nuevo — se
-- deriva con `where new_customer_id = customers.id and resolved_at is null`.
-- ============================================================================

create table public.customer_identity_conflicts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  new_customer_id uuid not null references public.customers (id) on delete cascade,
  matched_customer_ids uuid[] not null,
  signals jsonb not null,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

alter table public.customer_identity_conflicts enable row level security;

create policy "customer_identity_conflicts_select_authenticated"
  on public.customer_identity_conflicts for select to authenticated using (true);

create policy "customer_identity_conflicts_resolve_operations_or_owner"
  on public.customer_identity_conflicts for update to authenticated
  using (public.is_operations_or_owner())
  with check (public.is_operations_or_owner());

-- ============================================================================
-- submit_wholesale_request — agrega dirección/código postal, nuevos campos
-- obligatorios, dedup con detección de conflicto, snapshot del comprador y
-- canal de origen.
--
-- `create or replace function` sólo reemplaza una función cuya lista de
-- argumentos coincide exactamente. Como acá se agregan 2 parámetros nuevos
-- (13 → 15 argumentos), sin este drop explícito Postgres crearía un
-- SEGUNDO overload en vez de reemplazar el existente, y el `grant execute`
-- de más abajo (sin lista de argumentos) fallaría con 42725 "function name
-- is not unique" — ya pasó una vez esta sesión con el cambio anterior.
-- ============================================================================

drop function if exists public.submit_wholesale_request(
  text, text, text, text, text, text, text, text, text, text, text, jsonb, uuid
);

create or replace function public.submit_wholesale_request(
  p_first_name text,
  p_last_name text,
  p_company_name text,
  p_cuit text,
  p_instagram text,
  p_website text,
  p_city text,
  p_province text,
  p_address text,
  p_postal_code text,
  p_whatsapp text,
  p_email text,
  p_notes text,
  p_items jsonb,
  p_client_request_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_business_unit_id uuid;
  v_wholesale_tag_id uuid;
  v_web_channel_id uuid;
  v_order_id uuid;
  v_human_code text;
  v_existing_human_code text;
  v_item jsonb;
  v_variant_id uuid;
  v_quantity integer;
  v_price numeric;
  v_min_quantity integer;
  v_multiple_of integer;
  v_settings public.wholesale_settings%rowtype;
  v_total_amount numeric := 0;
  v_total_units integer := 0;
  v_id_by_whatsapp uuid;
  v_id_by_email uuid;
  v_id_by_cuit uuid;
  v_matched_ids uuid[] := array[]::uuid[];
  v_distinct_ids uuid[];
  v_terms_snapshot jsonb;
  v_buyer_snapshot jsonb;
begin
  if p_client_request_id is not null then
    select human_code into v_existing_human_code
    from public.orders
    where client_request_id = p_client_request_id;

    if v_existing_human_code is not null then
      return v_existing_human_code;
    end if;
  end if;

  if p_first_name is null or length(trim(p_first_name)) = 0 then
    raise exception 'Falta el nombre.';
  end if;
  if p_last_name is null or length(trim(p_last_name)) = 0 then
    raise exception 'Falta el apellido.';
  end if;
  if p_whatsapp is null or length(trim(p_whatsapp)) = 0 then
    raise exception 'Falta un WhatsApp de contacto.';
  end if;
  if p_email is null or length(trim(p_email)) = 0 then
    raise exception 'Falta el email.';
  end if;
  if p_company_name is null or length(trim(p_company_name)) = 0 then
    raise exception 'Falta la razón social o el nombre del comercio.';
  end if;
  if p_city is null or length(trim(p_city)) = 0 then
    raise exception 'Falta la ciudad.';
  end if;
  if p_province is null or length(trim(p_province)) = 0 then
    raise exception 'Falta la provincia.';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'El carrito está vacío.';
  end if;

  select * into v_settings from public.wholesale_settings limit 1;
  select id into v_business_unit_id from public.business_units where code = 'wholesale';
  select id into v_wholesale_tag_id from public.customer_tags where code = 'wholesale';
  select id into v_web_channel_id from public.sales_channels where code = 'web_mayorista';

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_variant_id := (v_item ->> 'product_variant_id')::uuid;
    v_quantity := (v_item ->> 'quantity')::integer;

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Cantidad inválida.';
    end if;

    select pli.unit_price into v_price
    from public.price_list_items pli
    join public.price_lists pl on pl.id = pli.price_list_id
    join public.product_variants pv on pv.id = pli.product_variant_id
    join public.products p on p.id = pv.product_id
    join public.wholesale_product_rules wpr on wpr.product_id = p.id
    where pl.code = 'wholesale'
      and pli.product_variant_id = v_variant_id
      and p.is_active and pv.is_active and wpr.is_public;

    if v_price is null then
      raise exception 'Uno de los productos ya no está disponible para mayoristas.';
    end if;

    select wpr.min_quantity, wpr.multiple_of into v_min_quantity, v_multiple_of
    from public.wholesale_product_rules wpr
    join public.product_variants pv on pv.product_id = wpr.product_id
    where pv.id = v_variant_id;

    if v_min_quantity is not null and v_quantity < v_min_quantity then
      raise exception 'La cantidad mínima de uno de los productos es %.', v_min_quantity;
    end if;
    if v_multiple_of is not null and v_multiple_of > 1 and v_quantity % v_multiple_of <> 0 then
      raise exception 'Uno de los productos debe pedirse en múltiplos de %.', v_multiple_of;
    end if;

    v_total_amount := v_total_amount + v_price * v_quantity;
    v_total_units := v_total_units + v_quantity;
  end loop;

  if v_settings.min_order_amount is not null and v_total_amount < v_settings.min_order_amount then
    raise exception 'El pedido no alcanza el mínimo mayorista de $%.', v_settings.min_order_amount;
  end if;
  if v_settings.min_total_units is not null and v_total_units < v_settings.min_total_units then
    raise exception 'El pedido no alcanza el mínimo de % piezas.', v_settings.min_total_units;
  end if;

  -- Dedup con detección de conflicto: 3 señales, buscadas por separado
  -- (nunca un OR combinado, para poder distinguir "una sola señal, un solo
  -- cliente" de "señales distintas, clientes distintos").
  select id into v_id_by_whatsapp from public.customers where whatsapp = p_whatsapp limit 1;
  select id into v_id_by_email from public.customers where email = p_email limit 1;
  if p_cuit is not null and length(trim(p_cuit)) > 0 then
    select id into v_id_by_cuit from public.customers where cuit = p_cuit limit 1;
  end if;

  if v_id_by_whatsapp is not null then v_matched_ids := array_append(v_matched_ids, v_id_by_whatsapp); end if;
  if v_id_by_email is not null then v_matched_ids := array_append(v_matched_ids, v_id_by_email); end if;
  if v_id_by_cuit is not null then v_matched_ids := array_append(v_matched_ids, v_id_by_cuit); end if;

  select array_agg(distinct x) into v_distinct_ids from unnest(v_matched_ids) as x;

  if v_distinct_ids is null then
    -- 0 señales encontradas: cliente nuevo, sin conflicto.
    insert into public.customers
      (first_name, last_name, company_name, cuit, instagram, website, city, province, address, postal_code, whatsapp, email)
    values
      (p_first_name, p_last_name, p_company_name, p_cuit, p_instagram, p_website, p_city, p_province, p_address, p_postal_code, p_whatsapp, p_email)
    returning id into v_customer_id;
  elsif array_length(v_distinct_ids, 1) = 1 then
    -- Todas las señales encontradas apuntan al mismo cliente: lo reusamos,
    -- completando sólo lo que hoy está en NULL (nunca pisamos un valor ya
    -- cargado).
    v_customer_id := v_distinct_ids[1];
    update public.customers set
      last_name = coalesce(last_name, p_last_name),
      company_name = coalesce(company_name, p_company_name),
      cuit = coalesce(cuit, p_cuit),
      instagram = coalesce(instagram, p_instagram),
      website = coalesce(website, p_website),
      city = coalesce(city, p_city),
      province = coalesce(province, p_province),
      address = coalesce(address, p_address),
      postal_code = coalesce(postal_code, p_postal_code),
      email = coalesce(email, p_email),
      whatsapp = coalesce(whatsapp, p_whatsapp)
    where id = v_customer_id;
  else
    -- Señales distintas apuntan a customers distintos: no se fusiona nada.
    -- Se crea un cliente nuevo para esta solicitud puntual (la arquitectura
    -- exige un customer_id) y se registra el conflicto para revisión
    -- manual — ver insert en customer_identity_conflicts más abajo, una
    -- vez que exista el order_id.
    insert into public.customers
      (first_name, last_name, company_name, cuit, instagram, website, city, province, address, postal_code, whatsapp, email)
    values
      (p_first_name, p_last_name, p_company_name, p_cuit, p_instagram, p_website, p_city, p_province, p_address, p_postal_code, p_whatsapp, p_email)
    returning id into v_customer_id;
  end if;

  insert into public.customer_tag_links (customer_id, tag_id)
  values (v_customer_id, v_wholesale_tag_id)
  on conflict do nothing;

  v_terms_snapshot := jsonb_build_object(
    'min_order_amount', v_settings.min_order_amount,
    'min_total_units', v_settings.min_total_units,
    'lead_time_min_days', v_settings.lead_time_min_days,
    'lead_time_max_days', v_settings.lead_time_max_days,
    'payment_terms', v_settings.payment_terms,
    'shipping_terms', v_settings.shipping_terms
  );

  v_buyer_snapshot := jsonb_build_object(
    'first_name', p_first_name,
    'last_name', p_last_name,
    'company_name', p_company_name,
    'cuit', p_cuit,
    'instagram', p_instagram,
    'website', p_website,
    'city', p_city,
    'province', p_province,
    'address', p_address,
    'postal_code', p_postal_code,
    'whatsapp', p_whatsapp,
    'email', p_email
  );

  insert into public.orders
    (business_unit_id, customer_id, notes, wholesale_terms_snapshot,
     wholesale_buyer_snapshot, origin_channel_id, client_request_id)
  values (
    v_business_unit_id, v_customer_id, p_notes, v_terms_snapshot,
    v_buyer_snapshot, v_web_channel_id, p_client_request_id
  )
  returning id, human_code into v_order_id, v_human_code;

  if v_distinct_ids is not null and array_length(v_distinct_ids, 1) > 1 then
    insert into public.customer_identity_conflicts
      (order_id, new_customer_id, matched_customer_ids, signals)
    values (
      v_order_id, v_customer_id, v_distinct_ids,
      jsonb_build_object(
        'whatsapp', case when v_id_by_whatsapp is not null
          then jsonb_build_object('customer_id', v_id_by_whatsapp, 'value', p_whatsapp) end,
        'email', case when v_id_by_email is not null
          then jsonb_build_object('customer_id', v_id_by_email, 'value', p_email) end,
        'cuit', case when v_id_by_cuit is not null
          then jsonb_build_object('customer_id', v_id_by_cuit, 'value', p_cuit) end
      )
    );
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_variant_id := (v_item ->> 'product_variant_id')::uuid;
    v_quantity := (v_item ->> 'quantity')::integer;

    select pli.unit_price into v_price
    from public.price_list_items pli
    join public.price_lists pl on pl.id = pli.price_list_id
    where pl.code = 'wholesale' and pli.product_variant_id = v_variant_id;

    insert into public.order_items (order_id, product_variant_id, quantity, unit_price)
    values (v_order_id, v_variant_id, v_quantity, v_price);
  end loop;

  return v_human_code;
end;
$$;

grant execute on function public.submit_wholesale_request(
  text, text, text, text, text, text, text, text, text, text, text, text, text, jsonb, uuid
) to anon, authenticated;

-- ============================================================================
-- mark_wholesale_whatsapp_share_opened — `orders` no tiene policy de
-- select/update para `anon`, así que esto necesita su propia RPC chica en
-- vez de un update directo desde el Server Action (que corre como anon a
-- propósito). Sólo setea el timestamp de "se abrió el botón de WhatsApp" —
-- nunca "se envió el mensaje", eso la app no lo puede saber con certeza.
-- ============================================================================

create or replace function public.mark_wholesale_whatsapp_share_opened(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.orders
  set whatsapp_share_opened_at = now()
  where id = p_order_id
    and whatsapp_share_opened_at is null;
end;
$$;

grant execute on function public.mark_wholesale_whatsapp_share_opened(uuid) to anon, authenticated;
