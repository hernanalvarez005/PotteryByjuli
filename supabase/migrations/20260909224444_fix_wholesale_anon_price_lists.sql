-- Fix: catálogo mayorista público vacío para `anon` (P0 producción).
--
-- Causa raíz — confirmada leyendo directo contra la base con la anon key,
-- no asumida: NO es un problema de datos (el producto de prueba real
-- "Adornitos" ya tenía is_active=true, wholesale_product_rules.is_public
-- = true y un precio en la lista 'wholesale', y anon podía leer products,
-- product_variants, wholesale_product_rules y product_categories sin
-- problema). El problema es una sola policy con una dependencia
-- transitiva rota:
--
--   price_list_items_select_public_wholesale (Fase 5) exige, dentro de
--   su propio EXISTS, que exista una fila en `price_lists` con
--   `code = 'wholesale'`. RLS se evalúa también para las tablas
--   referenciadas DENTRO de una policy, no sólo para la tabla en la que
--   se ejecuta el SELECT — y `price_lists` nunca tuvo una policy de
--   SELECT para `anon` (sólo `price_lists_select_authenticated`, Fase 2).
--   Sin ninguna policy que lo permita, anon ve cero filas de
--   `price_lists`, el join adentro del EXISTS nunca encuentra nada, y la
--   policy de `price_list_items` queda imposible de cumplir — sin
--   importar que products/variants/wholesale_product_rules estén
--   perfectamente configurados.
--
-- Efecto en cascada: `lib/wholesale.ts` lee price_list_items sin filtrar
-- explícitamente por price_list_id (confía en que RLS ya sólo devuelve la
-- fila de la lista mayorista) — con esa policy inutilizable, todo
-- variantId queda sin precio, `getWholesaleCatalog()` descarta todos los
-- productos (`.filter(v => v.unitPrice > 0)`), y `/mayorista` renderiza
-- "Todavía no hay productos publicados" para cualquier visitante anónimo,
-- mientras que un admin (rol `authenticated`, con
-- `price_list_items_select_authenticated using (true)`) ve todo con
-- normalidad — exactamente el síntoma reportado.
--
-- Fix: agregar la policy de anon que faltaba, acotada explícitamente a la
-- lista 'wholesale' — nunca 'retail' ni ninguna lista futura que no sea
-- pública (sección 7 del brief: "la policy debe identificar
-- explícitamente la lista"). No se toca ninguna otra policy: todas las
-- demás (products, product_variants, product_images,
-- wholesale_product_rules, product_categories, wholesale_settings) ya
-- estaban correctamente scoped y funcionando.

create policy "price_lists_select_anon_wholesale"
  on public.price_lists for select to anon
  using (code = 'wholesale');

-- ============================================================================
-- Segundo hallazgo, encontrado auditando el mismo camino (sección 6 del
-- brief: costo/margen nunca públicos): RLS controla qué FILAS ve un rol,
-- nunca qué COLUMNAS — con el grant de tabla completo que `anon` ya tiene
-- (default de Supabase), cualquiera podía pedir explícitamente
-- `cost_estimate` de un producto público (`lib/wholesale.ts` nunca lo
-- selecciona, pero eso sólo protege a la propia app — no a quien llama al
-- REST API de Supabase directo). Confirmado en vivo: hoy devuelve 0.00
-- porque ningún producto público tiene costo real cargado todavía, pero
-- es un hueco real esperando a que se cargue uno.
--
-- Fix: revocar el SELECT de tabla completa a `anon` sobre `products` y
-- re-otorgarlo columna por columna, excluyendo `cost_estimate`. Nunca se
-- toca el rol `authenticated` — el backoffice sigue viendo todo.
-- ============================================================================

revoke select on public.products from anon;
grant select (
  id, category_id, name, description, is_active,
  external_source, external_id, created_at, updated_at
) on public.products to anon;
