-- Fixture mínimo para desarrollo local y la suite E2E de Playwright
-- (docs/testing.md § Entorno E2E). `supabase start` y `supabase db reset`
-- lo aplican automáticamente sobre el Postgres local, DESPUÉS de las
-- migrations — nunca se aplica a producción (el CLI de Supabase nunca
-- incluye seed.sql en `db push`).

insert into public.product_categories (name, code) values ('Tazas', 'tazas-e2e');

insert into public.products (name, category_id, is_active)
values ('Taza E2E', (select id from public.product_categories where code = 'tazas-e2e'), true);

-- product_variants: la variante "Único" la crea el trigger
-- create_default_product_variant al insertar el producto arriba.

insert into public.price_list_items (price_list_id, product_variant_id, unit_price)
select
  (select id from public.price_lists where code = 'wholesale'),
  (select id from public.product_variants where product_id = (select id from public.products where name = 'Taza E2E')),
  15000;

insert into public.wholesale_product_rules (product_id, is_public, min_quantity)
values ((select id from public.products where name = 'Taza E2E'), true, 1);

update public.wholesale_settings
set min_order_amount = 10000, min_total_units = 5, business_whatsapp = '5491100000000'
where id = (select id from public.wholesale_settings limit 1);
