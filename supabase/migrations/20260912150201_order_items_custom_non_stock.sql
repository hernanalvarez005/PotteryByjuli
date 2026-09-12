-- Ítems no inventariados en pedidos (tanda de usabilidad, sección 8) —
-- un pedido personalizado puede incluir algo que se va a fabricar, que
-- todavía no existe en el catálogo, o que nunca va a ser un producto
-- permanente. Backward-compatible: nunca se hizo nullable una FK sin
-- revisar todos sus consumidores (auditoría completa antes de este
-- archivo) — set_order_status/production RPC ya hacen un `join` (no
-- `left join`) de order_items con inventory_items vía
-- product_variant_id, así que un ítem con product_variant_id null queda
-- automáticamente afuera de la reserva/consumo de stock, sin tocar esas
-- funciones. recalculate_order_totals tampoco depende de la columna.
-- product_safe_delete cuenta order_items filtrando por product_id de la
-- variante, así que un ítem custom nunca cuenta como "historial" de un
-- producto real.
--
-- Preferencia arquitectónica explícita del pedido: "catalog item" vs.
-- "custom/non-stock item" en la MISMA tabla — nunca un segundo sistema
-- de pedidos. Se logra con dos columnas de snapshot nuevas
-- (custom_name/custom_description) + un check que exige una de las dos
-- formas, nunca ninguna.

alter table public.order_items
  add column custom_name text,
  add column custom_description text,
  alter column product_variant_id drop not null;

alter table public.order_items
  add constraint order_items_catalog_or_custom check (
    product_variant_id is not null or custom_name is not null
  );

-- create_order — mismo signature (13 argumentos, sin cambios), sólo el
-- insert de order_items ahora acepta custom_name/custom_description por
-- ítem cuando no viene product_variant_id.
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
    notes, created_by
  ) values (
    p_business_unit_id, p_customer_id, p_location_id, p_origin_channel_id,
    p_closing_channel_id, p_delivery_method, p_delivery_address, p_estimated_date,
    p_notes, auth.uid()
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
