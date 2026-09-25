-- Duplicar un producto completo (deep clone de la DEFINICIÓN comercial).
--
-- Mapa de relaciones de un producto y qué se hace con cada una:
--
--   products                          → SE COPIA (nombre nuevo obligatorio)
--   ├─ product_variants               → SE COPIAN (ids nuevos; sku NULL)
--   │   ├─ inventory_items            → los crea el trigger (stock 0); se copia la unidad
--   │   ├─ price_list_items           → SE COPIAN a las variantes NUEVAS (todas las listas)
--   │   └─ product_images.variant_id  → se remapea a la variante nueva
--   ├─ product_images                 → SE COPIAN las filas; el ARCHIVO se comparte (no se re-sube)
--   ├─ wholesale_product_rules        → SE COPIA (is_public: ver p_publish_in_wholesale)
--   ├─ category_id                    → se copia la asociación (no la categoría)
--   └─ wholesale_featured_section_products → NO se copia (la pertenencia a una campaña es editorial)
--
--   NO se copia nada transaccional/histórico: order_items, production_orders,
--   inventory_movements, inventory_reservations, stock_transfer_items,
--   pagos, ventas. Stock de la copia = 0 (deriva del ledger, que arranca vacío).
--   Tampoco stock_thresholds (umbrales de alerta de un inventario real: una copia
--   con stock 0 dispararía alertas de "stock bajo" de inmediato).
--
-- Decisiones (documentadas también en docs/database.md):
--   * SKU: product_variants.sku es UNIQUE (parcial) → NUNCA se copia literalmente;
--     la copia queda con sku NULL.
--   * products.external_source/external_id (identidad de importación, UNIQUE) → NULL.
--   * products no tiene slug → no aplica. Los nombres de producto NO son únicos en
--     el esquema → no se introduce ninguna restricción nueva; sólo se exige que
--     el nombre sea no vacío y distinto del original.
--   * is_active se conserva (semántica global intacta).
--   * Visibilidad mayorista: por defecto la copia queda con is_public = false, porque
--     nace con las MISMAS fotos y precios que el original y publicarla así en
--     /mayorista mostraría un producto con nombre nuevo y fotos ajenas. Con
--     p_publish_in_wholesale = true conserva la visibilidad del original.
--     min_quantity / multiple_of / lead_time_days se copian siempre.
--   * Imágenes: se copian las FILAS (mismo storage_path). El archivo no se duplica.
--     La app borra un archivo sólo si ninguna otra fila lo referencia.
--
-- Atómica: una función plpgsql es una única transacción — cualquier error
-- (incluida una imagen inconsistente) deshace TODO, sin producto a medias.
--
-- SECURITY INVOKER: el RLS de cada tabla sigue aplicando. Duplicar escribe
-- price_list_items y wholesale_product_rules, que sólo puede escribir el owner
-- (products / variantes / imágenes las escribe también operations), así que
-- duplicar es sólo para el owner: no se amplían permisos.

create or replace function public.duplicate_product(
  p_source_product_id uuid,
  p_new_name text,
  p_publish_in_wholesale boolean default false
)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_source public.products%rowtype;
  v_new_id uuid;
  v_name text := btrim(coalesce(p_new_name, ''));
begin
  if not public.is_owner() then
    raise exception 'Sólo la administradora puede duplicar productos.';
  end if;

  select * into v_source from public.products where id = p_source_product_id;
  if not found then
    raise exception 'El producto original no existe.';
  end if;

  if v_name = '' then
    raise exception 'Falta el nuevo nombre.';
  end if;
  if v_name = btrim(v_source.name) then
    raise exception 'El nuevo nombre tiene que ser distinto del original.';
  end if;

  -- Producto: definición comercial; id/timestamps nuevos, sin identidad externa.
  insert into public.products (category_id, name, description, cost_estimate, is_active)
  values (v_source.category_id, v_name, v_source.description, v_source.cost_estimate, v_source.is_active)
  returning id into v_new_id;

  -- El trigger products_create_default_variant acaba de crear una variante
  -- "Único" (con su inventory_item, sin movimientos): se descarta para copiar
  -- EXACTAMENTE las variantes del original (que podrían no incluir "Único").
  delete from public.product_variants where product_id = v_new_id;

  -- Variantes (mismo nombre, orden y estado; sku NULL por ser único).
  -- El trigger crea un inventory_item por variante: stock 0, sin ledger.
  insert into public.product_variants (product_id, name, sku, sort_order, is_active)
  select v_new_id, ov.name, null, ov.sort_order, ov.is_active
  from public.product_variants ov
  where ov.product_id = p_source_product_id;

  -- Unidad de medida del inventario de cada variante (lo único configurable
  -- del inventory_item; el trigger la deja en 'unit').
  update public.inventory_items ni
     set unit = oi.unit
    from public.product_variants nv
    join public.product_variants ov on ov.product_id = p_source_product_id and ov.name = nv.name
    join public.inventory_items oi on oi.product_variant_id = ov.id
   where nv.product_id = v_new_id
     and ni.product_variant_id = nv.id;

  -- Mapa old→new: (product_id, name) es único, así que el nombre de la variante
  -- identifica una variante dentro de su producto.

  -- Una imagen cuya variante no pertenece al producto original es un dato
  -- inconsistente: abortar TODO en vez de copiarla mal.
  if exists (
    select 1
    from public.product_images pi
    left join public.product_variants ov on ov.id = pi.variant_id
    where pi.product_id = p_source_product_id
      and pi.variant_id is not null
      and ov.product_id is distinct from p_source_product_id
  ) then
    raise exception 'El producto tiene una imagen asociada a una variante que no le pertenece; corregila antes de duplicar.';
  end if;

  -- Precios: todas las listas, hacia las variantes NUEVAS.
  insert into public.price_list_items (price_list_id, product_variant_id, unit_price, updated_by)
  select pli.price_list_id, nv.id, pli.unit_price, auth.uid()
  from public.price_list_items pli
  join public.product_variants ov on ov.id = pli.product_variant_id and ov.product_id = p_source_product_id
  join public.product_variants nv on nv.product_id = v_new_id and nv.name = ov.name;

  -- Imágenes: se copian las filas; mismo archivo (no se vuelve a subir).
  insert into public.product_images (product_id, variant_id, storage_path, is_primary, sort_order)
  select v_new_id, nv.id, pi.storage_path, pi.is_primary, pi.sort_order
  from public.product_images pi
  left join public.product_variants ov on ov.id = pi.variant_id
  left join public.product_variants nv on nv.product_id = v_new_id and nv.name = ov.name
  where pi.product_id = p_source_product_id;

  -- Reglas mayoristas (si el original las tiene).
  insert into public.wholesale_product_rules (product_id, is_public, min_quantity, multiple_of, lead_time_days)
  select v_new_id, (r.is_public and coalesce(p_publish_in_wholesale, false)), r.min_quantity, r.multiple_of, r.lead_time_days
  from public.wholesale_product_rules r
  where r.product_id = p_source_product_id;

  return v_new_id;
end;
$$;

grant execute on function public.duplicate_product to authenticated;
