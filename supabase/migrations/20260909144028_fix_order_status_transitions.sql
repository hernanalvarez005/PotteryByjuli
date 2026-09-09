-- Fix — order status can only move forward
-- Found in review: nothing stopped moving an order backwards (e.g.
-- confirmed → pending). Re-confirming it afterwards would run the
-- "reserve stock + raise a production_order for the shortfall" block a
-- second time, double-reserving stock and creating a duplicate production
-- order for the same items. delivered/cancelled were also not actually
-- terminal — either could still be changed again.
--
-- This replaces set_order_status() (Fase 4/6) with the same body plus one
-- guard at the top: delivered/cancelled are final, and any other change
-- must move strictly forward through pending → confirmed → in_production
-- → ready → delivered, except cancelling, which is allowed from any
-- non-terminal state.

create or replace function public.order_status_rank(p_status public.order_status)
returns integer
language sql
immutable
as $$
  select case p_status
    when 'pending' then 0
    when 'confirmed' then 1
    when 'in_production' then 2
    when 'ready' then 3
    when 'delivered' then 4
    else null -- 'cancelled' has no rank: it's a side exit, not a step
  end;
$$;

create or replace function public.set_order_status(p_order_id uuid, p_new_status public.order_status)
returns void
language plpgsql
security invoker
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
  v_available integer;
  v_reserve_qty integer;
  v_shortfall integer;
  v_business_unit_code text;
  v_origin public.production_origin;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'Pedido no encontrado.';
  end if;

  if v_order.status in ('delivered', 'cancelled') then
    raise exception 'Este pedido ya está % y no se puede volver a cambiar.', v_order.status;
  end if;

  if p_new_status <> 'cancelled'
     and public.order_status_rank(p_new_status) <= public.order_status_rank(v_order.status) then
    raise exception 'No se puede pasar de % a % — el estado sólo avanza.', v_order.status, p_new_status;
  end if;

  if p_new_status = 'confirmed' and v_order.status = 'pending' then
    if v_order.location_id is null then
      raise exception 'Elegí una ubicación para el pedido antes de confirmarlo.';
    end if;

    select code into v_business_unit_code
    from public.business_units where id = v_order.business_unit_id;

    v_origin := case v_business_unit_code
      when 'retail' then 'retail_order'
      when 'wholesale' then 'wholesale_order'
      when 'custom' then 'custom_order'
      else 'restock'
    end;

    for v_item in
      select oi.product_variant_id, oi.quantity, ii.id as inventory_item_id
      from public.order_items oi
      join public.inventory_items ii on ii.product_variant_id = oi.product_variant_id
      where oi.order_id = p_order_id
    loop
      select coalesce(sum(m.quantity), 0)::integer into v_available
      from public.inventory_movements m
      where m.inventory_item_id = v_item.inventory_item_id and m.location_id = v_order.location_id;

      v_available := v_available - coalesce((
        select sum(r.quantity)::integer from public.inventory_reservations r
        where r.inventory_item_id = v_item.inventory_item_id
          and r.location_id = v_order.location_id and r.status = 'active'
      ), 0);

      v_reserve_qty := least(v_item.quantity, greatest(0, v_available));
      v_shortfall := v_item.quantity - v_reserve_qty;

      if v_reserve_qty > 0 then
        insert into public.inventory_reservations
          (inventory_item_id, location_id, order_id, quantity, status)
        values
          (v_item.inventory_item_id, v_order.location_id, p_order_id, v_reserve_qty, 'active');
      end if;

      if v_shortfall > 0 then
        insert into public.production_orders
          (origin, order_id, product_variant_id, location_id, quantity, notes)
        values
          (v_origin, p_order_id, v_item.product_variant_id, v_order.location_id, v_shortfall,
           'Generada automáticamente al confirmar ' || v_order.human_code);
      end if;
    end loop;
  end if;

  if p_new_status = 'delivered' then
    for v_item in
      select * from public.inventory_reservations
      where order_id = p_order_id and status = 'active'
    loop
      insert into public.inventory_movements
        (inventory_item_id, location_id, movement_type, quantity, reference_table, reference_id, created_by)
      values
        (v_item.inventory_item_id, v_item.location_id, 'sale', -v_item.quantity, 'orders', p_order_id, auth.uid());

      update public.inventory_reservations set status = 'consumed' where id = v_item.id;
    end loop;
  end if;

  if p_new_status = 'cancelled' then
    update public.inventory_reservations
    set status = 'released'
    where order_id = p_order_id and status = 'active';
  end if;

  update public.orders set status = p_new_status where id = p_order_id;
end;
$$;
