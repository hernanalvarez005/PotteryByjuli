-- Harden submit_wholesale_request — the one function `anon` can call.
-- Two review findings, both low-severity but cheap to close:
--   1. No cap on cart size — an anonymous caller could pass an array with
--      thousands of items and make the function do unbounded work per
--      request (a trivial DoS lever specifically on the public surface).
--   2. The second loop (writing order_items) re-looked-up each price
--      without repeating the is_active/is_public guard the first
--      (validating) loop used — relied entirely on nothing changing
--      between the two loops within the same transaction. Harmless in
--      practice, but re-checking costs nothing and removes the reliance.

create or replace function public.submit_wholesale_request(
  p_first_name text,
  p_last_name text,
  p_company_name text,
  p_cuit text,
  p_instagram text,
  p_website text,
  p_city text,
  p_province text,
  p_whatsapp text,
  p_email text,
  p_notes text,
  p_items jsonb
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
  v_order_id uuid;
  v_human_code text;
  v_item jsonb;
  v_variant_id uuid;
  v_quantity integer;
  v_price numeric;
  v_min_quantity integer;
  v_multiple_of integer;
  v_settings public.wholesale_settings%rowtype;
  v_total_amount numeric := 0;
  v_total_units integer := 0;
begin
  if p_first_name is null or length(trim(p_first_name)) = 0 then
    raise exception 'Falta el nombre.';
  end if;
  if p_whatsapp is null or length(trim(p_whatsapp)) = 0 then
    raise exception 'Falta un WhatsApp de contacto.';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'El carrito está vacío.';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'El carrito tiene demasiadas líneas.';
  end if;

  select * into v_settings from public.wholesale_settings limit 1;
  select id into v_business_unit_id from public.business_units where code = 'wholesale';
  select id into v_wholesale_tag_id from public.customer_tags where code = 'wholesale';

  -- Validate every line server-side before touching anything.
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

  -- Find-or-create the customer (match by WhatsApp, then email).
  select id into v_customer_id from public.customers
  where (whatsapp is not null and whatsapp = p_whatsapp)
     or (p_email is not null and length(trim(p_email)) > 0 and email = p_email)
  limit 1;

  if v_customer_id is null then
    insert into public.customers
      (first_name, last_name, company_name, cuit, instagram, website, city, province, whatsapp, email)
    values
      (p_first_name, p_last_name, p_company_name, p_cuit, p_instagram, p_website, p_city, p_province, p_whatsapp, p_email)
    returning id into v_customer_id;
  end if;

  insert into public.customer_tag_links (customer_id, tag_id)
  values (v_customer_id, v_wholesale_tag_id)
  on conflict do nothing;

  insert into public.orders (business_unit_id, customer_id, notes, wholesale_terms_snapshot)
  values (
    v_business_unit_id, v_customer_id, p_notes,
    jsonb_build_object(
      'min_order_amount', v_settings.min_order_amount,
      'min_total_units', v_settings.min_total_units,
      'lead_time_min_days', v_settings.lead_time_min_days,
      'lead_time_max_days', v_settings.lead_time_max_days,
      'payment_terms', v_settings.payment_terms,
      'shipping_terms', v_settings.shipping_terms
    )
  )
  returning id, human_code into v_order_id, v_human_code;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_variant_id := (v_item ->> 'product_variant_id')::uuid;
    v_quantity := (v_item ->> 'quantity')::integer;

    -- Same guard as the validation loop above — belt-and-suspenders
    -- rather than trusting nothing changed between the two loops.
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
      raise exception 'Uno de los productos dejó de estar disponible mientras se procesaba el pedido.';
    end if;

    insert into public.order_items (order_id, product_variant_id, quantity, unit_price)
    values (v_order_id, v_variant_id, v_quantity, v_price);
  end loop;

  return v_human_code;
end;
$$;

grant execute on function public.submit_wholesale_request to anon, authenticated;
