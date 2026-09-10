-- Borrado seguro de productos (individual y múltiple) — sección 6-10 del
-- brief de la tanda de mejoras operativas. Cambia deliberadamente la
-- política documentada hasta ahora en docs/business-rules.md ("products:
-- hard delete no, siempre") por una condicional, igual que
-- delete_customer_safe/delete_workshop_group_safe/etc.
-- (20260909184746_phase9_5_calendar_workshops_public.sql): sin historial
-- real, se borra; con historial, se bloquea con un mensaje que sugiere
-- desactivar.
--
-- "Historial real" = order_items, inventory_movements, production_orders
-- (todas via product_variants, ninguna cascadea desde ahí — Postgres ya
-- las protege con un error crudo de FK; esta función sólo antepone un
-- mensaje amigable). stock_thresholds NO es historial (es sólo un umbral
-- de alerta configurado por la usuaria) — se limpia explícitamente antes
-- de dejar que el borrado del producto cascadee, porque tampoco cascadea
-- desde inventory_items y si no se limpia bloquearía el borrado con un
-- error crudo igual que si fuera historial real.
-- inventory_reservations no necesita chequeo propio: sólo se crean junto
-- a order_items al confirmar un pedido (set_order_status), así que
-- order_items = 0 ya garantiza inventory_reservations = 0 para este
-- producto.

create or replace function public.delete_product_safe(p_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
  v_order_items integer;
  v_movements integer;
  v_production integer;
begin
  if not public.is_owner() then
    raise exception 'Sólo la administradora puede eliminar definitivamente.';
  end if;

  select count(*) into v_order_items
  from public.order_items oi
  join public.product_variants pv on pv.id = oi.product_variant_id
  where pv.product_id = p_id;

  select count(*) into v_movements
  from public.inventory_movements im
  join public.inventory_items ii on ii.id = im.inventory_item_id
  join public.product_variants pv on pv.id = ii.product_variant_id
  where pv.product_id = p_id;

  select count(*) into v_production
  from public.production_orders po
  join public.product_variants pv on pv.id = po.product_variant_id
  where pv.product_id = p_id;

  if v_order_items > 0 or v_movements > 0 or v_production > 0 then
    raise exception
      'No se puede eliminar: tiene % venta(s), % movimiento(s) de stock y % orden(es) de producción asociadas. Desactivalo en su lugar.',
      v_order_items, v_movements, v_production;
  end if;

  delete from public.stock_thresholds st
  using public.inventory_items ii, public.product_variants pv
  where st.inventory_item_id = ii.id
    and ii.product_variant_id = pv.id
    and pv.product_id = p_id;

  -- product_variants, product_images, price_list_items, inventory_items
  -- cascadean solos desde products/product_variants.
  delete from public.products where id = p_id;
end;
$$;

grant execute on function public.delete_product_safe to authenticated;

-- Read-only, para el preview del borrado múltiple. No hace falta gate de
-- owner: no escribe nada, y no revela más de lo que la RLS ya deja leer
-- por separado a cualquier authenticated (order_items/inventory_movements/
-- production_orders/products).
create or replace function public.classify_products_for_delete(p_ids uuid[])
returns table(
  product_id uuid,
  product_name text,
  deletable boolean,
  order_items_count integer,
  movements_count integer,
  production_orders_count integer
)
language plpgsql
security invoker
as $$
begin
  return query
  select
    p.id,
    p.name,
    (coalesce(oi.cnt, 0) = 0 and coalesce(im.cnt, 0) = 0 and coalesce(po.cnt, 0) = 0) as deletable,
    coalesce(oi.cnt, 0)::integer,
    coalesce(im.cnt, 0)::integer,
    coalesce(po.cnt, 0)::integer
  from public.products p
  left join lateral (
    select count(*) as cnt
    from public.order_items oi
    join public.product_variants pv on pv.id = oi.product_variant_id
    where pv.product_id = p.id
  ) oi on true
  left join lateral (
    select count(*) as cnt
    from public.inventory_movements im
    join public.inventory_items ii on ii.id = im.inventory_item_id
    join public.product_variants pv on pv.id = ii.product_variant_id
    where pv.product_id = p.id
  ) im on true
  left join lateral (
    select count(*) as cnt
    from public.production_orders po
    join public.product_variants pv on pv.id = po.product_variant_id
    where pv.product_id = p.id
  ) po on true
  where p.id = any(p_ids);
end;
$$;

grant execute on function public.classify_products_for_delete to authenticated;

-- Atómica: re-cuenta cada id por su cuenta (nunca confía en el preview de
-- classify_products_for_delete, que pudo haber quedado desactualizado
-- entre el preview y la confirmación), borra los elegibles y desactiva
-- los bloqueados, todo en una sola llamada. El loop NUNCA atrapa
-- excepciones por-id (nada de "begin/exception when others then
-- continue") — si algo inesperado falla a mitad de camino (una
-- dependencia que esta función no contempló), la excepción se propaga y
-- aborta TODA la función: como una función plpgsql ya es una única
-- transacción implícita, eso deshace cualquier cambio ya aplicado en esta
-- misma llamada. Nunca un resultado parcial.
create or replace function public.bulk_delete_products_safe(p_ids uuid[])
returns table(deleted_ids uuid[], deactivated_ids uuid[])
language plpgsql
security invoker
as $$
declare
  v_id uuid;
  v_order_items integer;
  v_movements integer;
  v_production integer;
  v_deleted uuid[] := array[]::uuid[];
  v_deactivated uuid[] := array[]::uuid[];
begin
  if not public.is_owner() then
    raise exception 'Sólo la administradora puede eliminar definitivamente.';
  end if;

  foreach v_id in array p_ids
  loop
    select count(*) into v_order_items
    from public.order_items oi
    join public.product_variants pv on pv.id = oi.product_variant_id
    where pv.product_id = v_id;

    select count(*) into v_movements
    from public.inventory_movements im
    join public.inventory_items ii on ii.id = im.inventory_item_id
    join public.product_variants pv on pv.id = ii.product_variant_id
    where pv.product_id = v_id;

    select count(*) into v_production
    from public.production_orders po
    join public.product_variants pv on pv.id = po.product_variant_id
    where pv.product_id = v_id;

    if v_order_items > 0 or v_movements > 0 or v_production > 0 then
      update public.products set is_active = false where id = v_id;
      v_deactivated := array_append(v_deactivated, v_id);
    else
      delete from public.stock_thresholds st
      using public.inventory_items ii, public.product_variants pv
      where st.inventory_item_id = ii.id
        and ii.product_variant_id = pv.id
        and pv.product_id = v_id;

      delete from public.products where id = v_id;
      v_deleted := array_append(v_deleted, v_id);
    end if;
  end loop;

  return query select v_deleted, v_deactivated;
end;
$$;

grant execute on function public.bulk_delete_products_safe to authenticated;
