-- "Modificar pedido": operación explícita, transaccional y auditada para agregar
-- ítems o ajustar cantidades de un pedido YA creado (caso real: una pieza pedida
-- después de la primera entrega, cobrada pero nunca incorporada al pedido).
--
-- Estado ANTERIOR (auditado): si `order_items` cambiaba después de crear el
-- pedido, el trigger `order_items_recalculate_totals` recalculaba subtotal/total
-- (saldo y KPI se actualizan solos, son derivados), pero NO pasaba nada con el
-- stock (las reservas y la producción se crean una sola vez, al confirmar), no
-- quedaba ningún rastro y el PDF no se marcaba. Además la política RLS de
-- `order_items` era `FOR ALL` para operations/owner: la API permitía editar en
-- silencio. Esta migración cierra eso:
--
--   1. `order_items`: sólo INSERT directo (create_order / checkout insertan con la
--      sesión del usuario). UPDATE y DELETE quedan SÓLO vía `modify_order`
--      (security definer) — igual que se hizo con DELETE de `orders` (#48).
--   2. `order_adjustments`: una fila INMUTABLE por modificación (quién, cuándo,
--      motivo, estado del pedido, subtotal/total antes y después, y las líneas
--      como jsonb, sin FK a `order_items` para que quitar un ítem no borre el rastro).
--   3. `modify_order(...)`: agregar ítem / subir cantidad en cualquier estado
--      activo; bajar o quitar sólo en `pending` (o ítems personalizados mientras
--      no esté entregado). Un pedido `delivered` sólo puede recibir ítems
--      posteriores (nunca reducirse). NO toca pagos, `sold_at` ni `sale_date`.
--   4. `order_attachments.generated_at`: cuándo se generó el PDF. Permite DERIVAR
--      "PDF desactualizado" (hay una modificación posterior); nunca se regenera solo.
--
-- Stock de un ítem agregado:
--   * pending                     → nada (todavía no hay reservas).
--   * confirmed/in_production/ready → reserva min(cantidad, disponible) y orden de
--                                     producción por lo faltante (misma lógica que al
--                                     confirmar en `set_order_status`, que NO se toca).
--   * delivered                   → si `p_consume_stock` (default true) descuenta con un
--                                     movimiento `sale` en la ubicación del pedido, validando
--                                     disponibilidad; si no, no mueve stock.

-- 1) order_items: sin UPDATE/DELETE directo --------------------------------------
drop policy if exists "order_items_write_operations" on public.order_items;

create policy "order_items_insert_operations" on public.order_items
  for insert to authenticated
  with check (public.is_operations_or_owner());

-- 2) Historial de modificaciones (append-only) ------------------------------------
create table public.order_adjustments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 1 and 300),
  status_at_change public.order_status not null,
  -- true = el pedido ya estaba entregado: es una modificación POSTERIOR a la entrega.
  after_delivery boolean not null,
  -- sólo significa algo cuando after_delivery: se pidió descontar stock de lo agregado.
  consume_stock boolean not null default false,
  subtotal_before numeric(12,2) not null,
  subtotal_after numeric(12,2) not null,
  total_before numeric(12,2) not null,
  total_after numeric(12,2) not null,
  -- [{op, order_item_id, label, product_variant_id, custom_name, quantity_before,
  --   quantity_after, unit_price, stock, ...}] — snapshot, sin FK.
  changes jsonb not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index order_adjustments_order_id_idx on public.order_adjustments (order_id, created_at desc);

alter table public.order_adjustments enable row level security;

create policy "order_adjustments_select_authenticated" on public.order_adjustments
  for select to authenticated using (true);

-- Sin políticas de escritura: sólo modify_order escribe y nadie edita ni borra.
revoke all on public.order_adjustments from anon;
revoke insert, update, delete on public.order_adjustments from authenticated;
grant select on public.order_adjustments to authenticated;

-- 3) PDF: cuándo se generó ------------------------------------------------------------
alter table public.order_attachments add column generated_at timestamptz;
update public.order_attachments set generated_at = created_at where generated_at is null;
alter table public.order_attachments
  alter column generated_at set default now(),
  alter column generated_at set not null;

-- 4) Efecto en stock de un ítem agregado (interno) -------------------------------------
create or replace function public.modify_order_stock_effect(
  p_order public.orders,
  p_variant_id uuid,
  p_quantity integer,
  p_consume_stock boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_id uuid;
  v_available numeric;
  v_reserve integer;
  v_shortfall integer;
  v_unit_code text;
  v_origin public.production_origin;
  v_label text;
  v_location_name text;
begin
  if p_order.status = 'pending' then
    return jsonb_build_object('stock', 'none');
  end if;

  select ii.id into v_item_id from public.inventory_items ii where ii.product_variant_id = p_variant_id;
  if v_item_id is null then
    return jsonb_build_object('stock', 'none');
  end if;

  if p_order.location_id is null then
    raise exception 'El pedido no tiene ubicación asignada: no se puede reservar ni descontar stock.';
  end if;

  select case when pv.name = 'Único' then p.name else p.name || ' — ' || pv.name end
    into v_label
    from public.product_variants pv join public.products p on p.id = pv.product_id
   where pv.id = p_variant_id;
  select l.name into v_location_name from public.locations l where l.id = p_order.location_id;

  -- Serializa con otras operaciones de stock sobre el mismo ítem/ubicación (mismo lock
  -- que usa la venta rápida).
  perform pg_advisory_xact_lock(hashtext(v_item_id::text), hashtext(p_order.location_id::text));

  select coalesce(sum(m.quantity), 0) into v_available
    from public.inventory_movements m
   where m.inventory_item_id = v_item_id and m.location_id = p_order.location_id;
  v_available := v_available - coalesce((
    select sum(r.quantity) from public.inventory_reservations r
     where r.inventory_item_id = v_item_id and r.location_id = p_order.location_id and r.status = 'active'
  ), 0);

  if p_order.status = 'delivered' then
    if not p_consume_stock then
      return jsonb_build_object('stock', 'not_consumed');
    end if;
    if p_quantity > v_available then
      raise exception 'No hay stock suficiente de %. Disponible en %: %. Desmarcá "Descontar del stock" si la pieza ya salió.',
        v_label, v_location_name, greatest(0, v_available)::integer;
    end if;
    insert into public.inventory_movements
      (inventory_item_id, location_id, movement_type, quantity, reference_table, reference_id, reason, created_by)
    values
      (v_item_id, p_order.location_id, 'sale', -p_quantity, 'orders', p_order.id,
       'Ítem agregado después de la entrega — ' || p_order.human_code, auth.uid());
    return jsonb_build_object('stock', 'consumed', 'consumed', p_quantity);
  end if;

  -- confirmed / in_production / ready: reserva lo disponible y manda a producir el resto.
  v_reserve := least(p_quantity, greatest(0, v_available))::integer;
  v_shortfall := p_quantity - v_reserve;

  if v_reserve > 0 then
    insert into public.inventory_reservations (inventory_item_id, location_id, order_id, quantity, status)
    values (v_item_id, p_order.location_id, p_order.id, v_reserve, 'active');
  end if;

  if v_shortfall > 0 then
    select bu.code into v_unit_code from public.business_units bu where bu.id = p_order.business_unit_id;
    v_origin := case v_unit_code
      when 'retail' then 'retail_order'
      when 'wholesale' then 'wholesale_order'
      when 'custom' then 'custom_order'
      else 'restock'
    end;
    insert into public.production_orders (origin, order_id, product_variant_id, location_id, quantity, notes)
    values (v_origin, p_order.id, p_variant_id, p_order.location_id, v_shortfall,
            'Generada automáticamente al modificar ' || p_order.human_code);
  end if;

  return jsonb_build_object('stock', 'reserved', 'reserved', v_reserve, 'to_produce', v_shortfall);
end;
$$;

-- Función interna: sólo la invoca modify_order (que corre como su dueño).
revoke execute on function public.modify_order_stock_effect(public.orders, uuid, integer, boolean) from public, anon, authenticated;

-- 5) Modificar pedido --------------------------------------------------------------------
-- p_changes: arreglo de
--   {"op":"add","product_variant_id":uuid,"quantity":n,"unit_price":x}
--   {"op":"add","custom_name":"…","custom_description":"…","quantity":n,"unit_price":x}
--   {"op":"set_quantity","order_item_id":uuid,"quantity":n}
--   {"op":"remove","order_item_id":uuid}
create or replace function public.modify_order(
  p_order_id uuid,
  p_changes jsonb,
  p_reason text,
  p_consume_stock boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_change jsonb;
  v_op text;
  v_item public.order_items%rowtype;
  v_variant_id uuid;
  v_custom text;
  v_description text;
  v_qty integer;
  v_price numeric;
  v_label text;
  v_is_custom boolean;
  v_effect jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_remaining integer;
  v_new_subtotal numeric;
  v_new_total numeric;
  v_adj_id uuid;
begin
  if not public.is_operations_or_owner() then
    raise exception 'No tenés permiso para modificar pedidos.';
  end if;
  if v_reason = '' then
    raise exception 'El motivo de la modificación es obligatorio.';
  end if;
  if char_length(v_reason) > 300 then
    raise exception 'El motivo no puede superar los 300 caracteres.';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'No hay cambios para aplicar.';
  end if;
  if jsonb_array_length(p_changes) > 50 then
    raise exception 'Demasiados cambios en una sola modificación (máximo 50).';
  end if;

  -- Bloquea el pedido: serializa con cambios de estado y otras modificaciones.
  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'El pedido no existe.';
  end if;
  if v_order.operation_type <> 'order' then
    raise exception 'Las ventas rápidas no se modifican desde acá.';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'El pedido está cancelado y no se puede modificar.';
  end if;

  for v_change in select * from jsonb_array_elements(p_changes)
  loop
    v_op := v_change ->> 'op';

    if v_op = 'add' then
      v_variant_id := nullif(v_change ->> 'product_variant_id', '')::uuid;
      v_custom := nullif(btrim(coalesce(v_change ->> 'custom_name', '')), '');
      v_description := nullif(btrim(coalesce(v_change ->> 'custom_description', '')), '');
      v_qty := (v_change ->> 'quantity')::integer;
      v_price := (v_change ->> 'unit_price')::numeric;

      if v_qty is null or v_qty <= 0 then
        raise exception 'Cantidad inválida.';
      end if;
      if v_price is null or v_price < 0 then
        raise exception 'Precio inválido.';
      end if;
      if (v_variant_id is null) = (v_custom is null) then
        raise exception 'Cada ítem nuevo necesita un producto del catálogo o un nombre (no ambos).';
      end if;

      if v_variant_id is not null then
        v_label := null;
        select case when pv.name = 'Único' then p.name else p.name || ' — ' || pv.name end
          into v_label
          from public.product_variants pv join public.products p on p.id = pv.product_id
         where pv.id = v_variant_id and pv.is_active and p.is_active;
        if v_label is null then
          raise exception 'Uno de los productos no está disponible.';
        end if;
      else
        if char_length(v_custom) > 200 then
          raise exception 'El nombre del ítem no puede superar los 200 caracteres.';
        end if;
        v_label := v_custom;
      end if;

      insert into public.order_items (order_id, product_variant_id, quantity, unit_price, custom_name, custom_description)
      values (p_order_id, v_variant_id, v_qty, v_price, v_custom, v_description)
      returning * into v_item;

      v_effect := case
        when v_variant_id is not null then public.modify_order_stock_effect(v_order, v_variant_id, v_qty, p_consume_stock)
        else jsonb_build_object('stock', 'none')
      end;

      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'op', 'add', 'order_item_id', v_item.id, 'label', v_label,
          'product_variant_id', v_variant_id, 'custom_name', v_custom,
          'quantity_before', 0, 'quantity_after', v_qty, 'unit_price', v_price
        ) || v_effect
      );

    elsif v_op in ('set_quantity', 'remove') then
      select * into v_item from public.order_items i
       where i.id = nullif(v_change ->> 'order_item_id', '')::uuid and i.order_id = p_order_id
       for update;
      if not found then
        raise exception 'El ítem no pertenece a este pedido.';
      end if;
      v_is_custom := v_item.product_variant_id is null;

      if v_is_custom then
        v_label := v_item.custom_name;
      else
        select case when pv.name = 'Único' then p.name else p.name || ' — ' || pv.name end
          into v_label
          from public.product_variants pv join public.products p on p.id = pv.product_id
         where pv.id = v_item.product_variant_id;
      end if;

      if v_op = 'remove' then
        if v_order.status = 'delivered' then
          raise exception 'El pedido ya fue entregado: no se pueden quitar ítems (es historia).';
        end if;
        if v_order.status <> 'pending' and not v_is_custom then
          raise exception 'No se puede quitar "%" de un pedido ya confirmado: tiene stock reservado o producción asociada. Quitar ítems de catálogo sólo se permite mientras el pedido está pendiente.', v_label;
        end if;
        delete from public.order_items where id = v_item.id;
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'op', 'remove', 'order_item_id', v_item.id, 'label', v_label,
          'product_variant_id', v_item.product_variant_id, 'custom_name', v_item.custom_name,
          'quantity_before', v_item.quantity, 'quantity_after', 0, 'unit_price', v_item.unit_price,
          'stock', 'none'
        ));

      else -- set_quantity
        v_qty := (v_change ->> 'quantity')::integer;
        if v_qty is null or v_qty <= 0 then
          raise exception 'Cantidad inválida. Para quitar un ítem usá "Quitar".';
        end if;
        if v_qty = v_item.quantity then
          raise exception 'La cantidad de "%" no cambió.', v_label;
        end if;

        if v_qty > v_item.quantity then
          update public.order_items set quantity = v_qty where id = v_item.id;
          v_effect := case
            when not v_is_custom then
              public.modify_order_stock_effect(v_order, v_item.product_variant_id, v_qty - v_item.quantity, p_consume_stock)
            else jsonb_build_object('stock', 'none')
          end;
        else
          if v_order.status = 'delivered' then
            raise exception 'El pedido ya fue entregado: no se pueden reducir ítems (es historia).';
          end if;
          if v_order.status <> 'pending' and not v_is_custom then
            raise exception 'No se puede reducir "%" en un pedido ya confirmado: tiene stock reservado o producción asociada. Reducir ítems de catálogo sólo se permite mientras el pedido está pendiente.', v_label;
          end if;
          update public.order_items set quantity = v_qty where id = v_item.id;
          v_effect := jsonb_build_object('stock', 'none');
        end if;

        v_lines := v_lines || jsonb_build_array(
          jsonb_build_object(
            'op', 'set_quantity', 'order_item_id', v_item.id, 'label', v_label,
            'product_variant_id', v_item.product_variant_id, 'custom_name', v_item.custom_name,
            'quantity_before', v_item.quantity, 'quantity_after', v_qty, 'unit_price', v_item.unit_price
          ) || v_effect
        );
      end if;

    else
      raise exception 'Operación desconocida: %.', coalesce(v_op, '(vacía)');
    end if;
  end loop;

  select count(*) into v_remaining from public.order_items i where i.order_id = p_order_id;
  if v_remaining = 0 then
    raise exception 'El pedido tiene que conservar al menos un ítem.';
  end if;

  -- Los totales los recalcula el trigger existente (order_items_recalculate_totals).
  select o.subtotal, o.total into v_new_subtotal, v_new_total from public.orders o where o.id = p_order_id;
  if v_new_total < 0 then
    raise exception 'El descuento del pedido supera el nuevo subtotal.';
  end if;

  insert into public.order_adjustments
    (order_id, reason, status_at_change, after_delivery, consume_stock,
     subtotal_before, subtotal_after, total_before, total_after, changes, created_by)
  values
    (p_order_id, v_reason, v_order.status, v_order.status = 'delivered',
     v_order.status = 'delivered' and coalesce(p_consume_stock, false),
     v_order.subtotal, v_new_subtotal, v_order.total, v_new_total, v_lines, auth.uid())
  returning id into v_adj_id;

  return v_adj_id;
end;
$$;

revoke execute on function public.modify_order(uuid, jsonb, text, boolean) from public, anon;
grant execute on function public.modify_order(uuid, jsonb, text, boolean) to authenticated;
