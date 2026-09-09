-- Phase 5 — Wholesale portal
-- The highest business priority in the whole project: replace "catálogo +
-- Excel + WhatsApp" with one public link. A submitted cart is a REQUEST,
-- never a confirmed sale — see set_order_status() from Fase 4 for what
-- actually happens on confirmation. See docs/business-rules.md.

-- ============================================================================
-- Configuration — editable only by the owner from /configuracion.
-- Singleton table: exactly one row, seeded below, updated in place.
-- ============================================================================

create table public.wholesale_settings (
  id uuid primary key default gen_random_uuid(),
  min_order_amount numeric(12, 2),
  min_total_units integer,
  lead_time_min_days integer,
  lead_time_max_days integer,
  payment_terms text,
  shipping_terms text,
  commercial_message text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

create trigger set_wholesale_settings_updated_at
  before update on public.wholesale_settings
  for each row execute function public.set_updated_at();

insert into public.wholesale_settings (
  min_order_amount, min_total_units, lead_time_min_days, lead_time_max_days,
  payment_terms, shipping_terms, commercial_message
) values (
  200000, 20, 15, 25,
  '50% de seña, 50% antes de la entrega.',
  'A coordinar según destino.',
  'Gracias por tu interés en Pottery. Elegí tus productos y armá tu pedido — te confirmamos disponibilidad y fecha estimada apenas lo recibimos.'
);

-- Per-product wholesale rules. Deliberately per-product, not per-variant —
-- "mínimo 4 tazas" applies across all its colors, matching how Juli
-- actually thinks about minimums (sección 9).
create table public.wholesale_product_rules (
  product_id uuid primary key references public.products (id) on delete cascade,
  is_public boolean not null default false,
  min_quantity integer check (min_quantity > 0),
  multiple_of integer check (multiple_of > 0),
  lead_time_days integer check (lead_time_days > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_wholesale_product_rules_updated_at
  before update on public.wholesale_product_rules
  for each row execute function public.set_updated_at();

-- ============================================================================
-- orders: snapshot of the wholesale conditions in effect when the request
-- was submitted — changing wholesale_settings tomorrow must never alter
-- what a past request shows (sección 11, sección 91).
-- ============================================================================

alter table public.orders add column wholesale_terms_snapshot jsonb;

-- Wholesale requests get a MAY- prefix instead of PED-, same sequence,
-- same table — cosmetic only, per sección 48. Replaces the Fase 3 version.
create or replace function public.generate_order_human_code()
returns trigger
language plpgsql
as $$
declare
  v_is_wholesale boolean;
begin
  if new.human_code is not null then
    return new;
  end if;

  select (code = 'wholesale') into v_is_wholesale
  from public.business_units where id = new.business_unit_id;

  new.human_code := (case when v_is_wholesale then 'MAY-' else 'PED-' end)
    || lpad(nextval('public.orders_human_code_seq')::text, 6, '0');
  return new;
end;
$$;

-- ============================================================================
-- submit_wholesale_request — the ONLY way an anonymous visitor touches the
-- database. SECURITY DEFINER: runs with elevated rights on purpose, but
-- everything it does is narrow and server-validated —
--   * prices are always looked up server-side, never trusted from the
--     client (a tampered cart can't buy at a fake price);
--   * minimums/multiples are re-validated here too, not just in the UI;
--   * it can only create a customer + one order + its items, nothing else.
-- This is what keeps the public RLS surface (below) safe to open at all.
-- ============================================================================

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
  p_items jsonb -- [{product_variant_id, quantity}], no price — server decides that
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

grant execute on function public.submit_wholesale_request to anon, authenticated;

-- ============================================================================
-- Row Level Security — new tables
-- ============================================================================

alter table public.wholesale_settings enable row level security;
alter table public.wholesale_product_rules enable row level security;

create policy "wholesale_settings_select_authenticated"
  on public.wholesale_settings for select to authenticated using (true);
create policy "wholesale_settings_select_anon"
  on public.wholesale_settings for select to anon using (true);
create policy "wholesale_settings_write_owner"
  on public.wholesale_settings for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

create policy "wholesale_product_rules_select_authenticated"
  on public.wholesale_product_rules for select to authenticated using (true);
create policy "wholesale_product_rules_select_anon"
  on public.wholesale_product_rules for select to anon using (is_public = true);
create policy "wholesale_product_rules_write_owner"
  on public.wholesale_product_rules for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- ============================================================================
-- Public read access — the narrow slice of the catalog an anonymous
-- visitor may see. Everything else (customers, orders, stock, costs,
-- reports) stays completely invisible to the `anon` role — no policy for
-- anon means no access, by default (sección 53, sección 84).
-- ============================================================================

create policy "products_select_public_wholesale"
  on public.products for select to anon
  using (
    is_active and exists (
      select 1 from public.wholesale_product_rules wpr
      where wpr.product_id = products.id and wpr.is_public
    )
  );

create policy "product_variants_select_public_wholesale"
  on public.product_variants for select to anon
  using (
    is_active and exists (
      select 1 from public.products p
      join public.wholesale_product_rules wpr on wpr.product_id = p.id
      where p.id = product_variants.product_id and p.is_active and wpr.is_public
    )
  );

create policy "product_images_select_public_wholesale"
  on public.product_images for select to anon
  using (
    exists (
      select 1 from public.products p
      join public.wholesale_product_rules wpr on wpr.product_id = p.id
      where p.id = product_images.product_id and p.is_active and wpr.is_public
    )
  );

create policy "product_categories_select_anon"
  on public.product_categories for select to anon using (is_active);

create policy "price_list_items_select_public_wholesale"
  on public.price_list_items for select to anon
  using (
    exists (
      select 1 from public.price_lists pl
      join public.product_variants pv on pv.id = price_list_items.product_variant_id
      join public.products p on p.id = pv.product_id
      join public.wholesale_product_rules wpr on wpr.product_id = p.id
      where pl.id = price_list_items.price_list_id
        and pl.code = 'wholesale'
        and p.is_active and pv.is_active and wpr.is_public
    )
  );
