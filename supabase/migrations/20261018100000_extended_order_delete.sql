-- Eliminación segura ampliada: pruebas del checkout cancelado, cancelados con producción sin
-- tocar y ventas rápidas cargadas por error.
--
-- Hasta ahora `classify_order_for_delete` bloqueaba (a) todo pedido del checkout mayorista, (b) todo
-- pedido con alguna orden de producción y (c) toda venta rápida (queda `delivered`, con pago y
-- movimiento de stock). Eso dejaba sin salida casos reales sin consecuencias comerciales: un
-- checkout de prueba ya cancelado, un pedido cancelado cuya producción nunca arrancó, o una venta
-- rápida registrada por error.
--
-- La regla sigue viviendo SÓLO en Postgres (classify es la única fuente de la regla y del mensaje;
-- delete_order_safe la re-verifica con el pedido bloqueado FOR UPDATE). Niveles:
--   simple               como hoy: no entregado, no checkout, 0 pagos, 0 movimientos, 0 producción.
--   untouched_production cancelado, 0 pagos, 0 movimientos; su producción está SIN TOCAR (status
--                        pending/cancelled, 0 producidas, 0 rechazadas) y se borra con el pedido.
--   test_checkout        cancelado, viene del checkout, 0 pagos, 0 movimientos, producción sin tocar.
--                        Exige confirmación ("era una prueba/error"), motivo y tipear el código.
--   quick_sale           operation_type = 'retail_sale' (con sus pagos). Exige lo mismo, y repone el
--                        stock con un movimiento `return` compensatorio (el `sale` original NO se borra).
-- Nunca se borra: un pedido normal entregado, ni un pedido normal con pagos, movimientos o producción
-- efectiva (se cancela / se corrige el pago). Sólo la owner.
--
-- Auditoría: `order_deletions` suma deletion_level, declared_test y `details` (snapshot jsonb completo:
-- ítems, pagos, movimientos, producción borrada, comprador del checkout). Sigue append-only.
--
-- Hardening: ambas funciones con search_path fijo `public, pg_temp` y ACL explícita (antes tenían el
-- EXECUTE por defecto para PUBLIC/anon).

-- 1) Auditoría ampliada ----------------------------------------------------------------
alter table public.order_deletions
  add column deletion_level text not null default 'simple'
    check (deletion_level in ('simple', 'untouched_production', 'test_checkout', 'quick_sale')),
  add column declared_test boolean not null default false,
  add column details jsonb;

-- 2) Clasificación ----------------------------------------------------------------------
drop function if exists public.classify_order_for_delete(uuid);

create function public.classify_order_for_delete(p_id uuid)
returns table(
  order_id uuid,
  human_code text,
  status public.order_status,
  operation_type text,
  level text,
  deletable boolean,
  block_message text,
  payments_count integer,
  payments_total numeric,
  movements_count integer,
  production_orders_count integer,
  from_checkout boolean,
  requires_confirmation boolean,
  requires_reason boolean,
  stock_units_to_return integer
)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_payments integer;
  v_pay_total numeric;
  v_movements integer;
  v_foreign_movements integer;
  v_net_units numeric;
  v_production integer;
  v_untouched integer;
  v_checkout boolean;
  v_suffix text;
  v_generic constant text := 'Este pedido ya tiene movimientos asociados y no puede eliminarse.';
begin
  select * into v_order from public.orders o where o.id = p_id;
  if not found then
    raise exception 'El pedido no existe.';
  end if;

  select count(*), coalesce(sum(p.amount), 0) into v_payments, v_pay_total
    from public.payments p where p.order_id = p_id;
  select count(*),
         count(*) filter (where m.movement_type not in ('sale', 'return')),
         coalesce(sum(m.quantity), 0)
    into v_movements, v_foreign_movements, v_net_units
    from public.inventory_movements m where m.reference_table = 'orders' and m.reference_id = p_id;
  -- "Sin tocar": nunca avanzó ni produjo nada. Cualquier otra cosa es producción efectiva.
  select count(*),
         count(*) filter (
           where po.status in ('pending', 'cancelled')
             and coalesce(po.produced_quantity, 0) = 0
             and coalesce(po.rejected_quantity, 0) = 0
         )
    into v_production, v_untouched
    from public.production_orders po where po.order_id = p_id;
  v_checkout := v_order.wholesale_buyer_snapshot is not null or v_order.wholesale_terms_snapshot is not null;

  -- "Podés cancelarlo" sólo si cancelar es posible (no entregado/cancelado).
  v_suffix := case when v_order.status in ('delivered', 'cancelled') then '' else ' Podés cancelarlo.' end;

  order_id := v_order.id;
  human_code := v_order.human_code;
  status := v_order.status;
  operation_type := v_order.operation_type;
  payments_count := v_payments;
  payments_total := v_pay_total;
  movements_count := v_movements;
  production_orders_count := v_production;
  from_checkout := v_checkout;
  level := null;
  requires_confirmation := false;
  requires_reason := false;
  stock_units_to_return := 0;

  if v_order.operation_type = 'retail_sale' then
    if v_production > 0 then
      deletable := false;
      block_message := 'Esta venta tiene órdenes de producción asociadas y no puede eliminarse.';
    elsif v_foreign_movements > 0 then
      deletable := false;
      block_message := 'Esta venta tiene movimientos de stock que no son de la propia venta y no puede eliminarse.';
    else
      deletable := true;
      block_message := null;
      level := 'quick_sale';
      requires_confirmation := true;
      requires_reason := true;
      stock_units_to_return := greatest(0, -v_net_units)::integer;
    end if;
  elsif v_order.status = 'delivered' then
    deletable := false;
    block_message := 'Este pedido ya fue entregado y no puede eliminarse.';
  elsif v_checkout and v_order.status <> 'cancelled' then
    deletable := false;
    block_message := 'Este pedido es una solicitud del checkout mayorista y no puede eliminarse.' || v_suffix;
  elsif v_payments > 0 or v_movements > 0 or v_production > v_untouched then
    deletable := false;
    block_message := v_generic || v_suffix;
  elsif v_checkout then
    -- Checkout ya cancelado, sin pagos, sin movimientos y sin producción efectiva.
    deletable := true;
    block_message := null;
    level := 'test_checkout';
    requires_confirmation := true;
    requires_reason := true;
  elsif v_production > 0 then
    if v_order.status = 'cancelled' then
      deletable := true;
      block_message := null;
      level := 'untouched_production';
    else
      deletable := false;
      block_message := v_generic || v_suffix;
    end if;
  else
    deletable := true;
    block_message := null;
    level := 'simple';
  end if;

  return next;
end;
$$;

revoke all on function public.classify_order_for_delete(uuid) from public, anon, authenticated, service_role;
grant execute on function public.classify_order_for_delete(uuid) to authenticated;

-- 3) Borrado ------------------------------------------------------------------------------
drop function if exists public.delete_order_safe(uuid, text);

create function public.delete_order_safe(
  p_id uuid,
  p_reason text default null,
  p_confirm_code text default null,
  p_confirmed boolean default false
)
returns table(human_code text, storage_paths text[])
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_check record;
  v_items integer;
  v_paths text[];
  v_details jsonb;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_mov record;
begin
  if not public.is_owner() then
    raise exception 'Sólo la administradora puede eliminar pedidos.';
  end if;

  if v_reason is not null and char_length(v_reason) > 300 then
    raise exception 'El motivo no puede superar los 300 caracteres.';
  end if;

  -- Bloquea el pedido: un pago o un cambio de estado concurrente espera a que termine esta
  -- transacción (o ya está confirmado y lo ve el chequeo de abajo). También su producción, para que
  -- una orden no avance mientras se decide si estaba "sin tocar".
  select * into v_order from public.orders o where o.id = p_id for update;
  if not found then
    raise exception 'El pedido no existe.';
  end if;
  perform 1 from public.production_orders po where po.order_id = p_id for update;

  select * into v_check from public.classify_order_for_delete(p_id);
  if not v_check.deletable then
    raise exception '%', v_check.block_message;
  end if;

  if v_check.requires_reason and v_reason is null then
    raise exception 'Indicá el motivo de la eliminación.';
  end if;
  if v_check.requires_confirmation then
    if not coalesce(p_confirmed, false) then
      raise exception 'Tenés que confirmar la eliminación.';
    end if;
    if upper(btrim(coalesce(p_confirm_code, ''))) <> upper(v_order.human_code) then
      raise exception 'El código ingresado no coincide con el del pedido.';
    end if;
  end if;

  select count(*) into v_items from public.order_items oi where oi.order_id = p_id;
  select coalesce(array_agg(a.storage_path), '{}') into v_paths
    from public.order_attachments a where a.order_id = p_id;

  -- Snapshot completo ANTES de borrar nada.
  v_details := jsonb_build_object(
    'level', v_check.level,
    'operation_type', v_order.operation_type,
    'location_id', v_order.location_id,
    'subtotal', v_order.subtotal,
    'discount_total', v_order.discount_total,
    'sale_date', v_order.sale_date,
    'sold_at', v_order.sold_at,
    'wholesale_buyer_snapshot', v_order.wholesale_buyer_snapshot,
    'wholesale_terms_snapshot', v_order.wholesale_terms_snapshot,
    'payments_total', v_check.payments_total,
    'stock_units_returned', v_check.stock_units_to_return,
    'items', coalesce((select jsonb_agg(to_jsonb(oi) - 'order_id') from public.order_items oi where oi.order_id = p_id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(to_jsonb(p) - 'order_id') from public.payments p where p.order_id = p_id), '[]'::jsonb),
    'movements', coalesce((select jsonb_agg(to_jsonb(m)) from public.inventory_movements m
                            where m.reference_table = 'orders' and m.reference_id = p_id), '[]'::jsonb),
    'production_orders', coalesce((select jsonb_agg(to_jsonb(po)) from public.production_orders po where po.order_id = p_id), '[]'::jsonb)
  );

  -- Venta rápida: el stock vuelve por COMPENSACIÓN. El movimiento `sale` original no se borra (el
  -- libro de stock queda íntegro); se agrega un `return` por el neto de cada ítem/ubicación, con el
  -- mismo lock de la venta y en orden determinístico (sin deadlocks entre ventas simultáneas).
  if v_check.level = 'quick_sale' then
    for v_mov in
      select m.inventory_item_id, m.location_id, sum(m.quantity) as net
        from public.inventory_movements m
       where m.reference_table = 'orders' and m.reference_id = p_id
       group by m.inventory_item_id, m.location_id
      having sum(m.quantity) < 0
       order by m.inventory_item_id, m.location_id
    loop
      perform pg_advisory_xact_lock(hashtext(v_mov.inventory_item_id::text), hashtext(v_mov.location_id::text));
      insert into public.inventory_movements
        (inventory_item_id, location_id, movement_type, quantity, reference_table, reference_id, reason, created_by)
      values
        (v_mov.inventory_item_id, v_mov.location_id, 'return', -v_mov.net, 'orders', p_id,
         'Eliminación de venta rápida ' || v_order.human_code, auth.uid());
    end loop;
  end if;

  -- Producción sin tocar: se va con el pedido (si no, `ON DELETE SET NULL` la dejaría huérfana).
  if v_check.level in ('untouched_production', 'test_checkout') then
    delete from public.production_orders po where po.order_id = p_id;
  end if;

  insert into public.order_deletions
    (order_id, human_code, business_unit_id, customer_id, status, total, item_count, order_created_at,
     reason, deleted_by, deletion_level, declared_test, details)
  values
    (v_order.id, v_order.human_code, v_order.business_unit_id, v_order.customer_id, v_order.status,
     v_order.total, v_items, v_order.created_at, v_reason, auth.uid(), v_check.level,
     v_check.level = 'test_checkout', v_details);

  -- Cascada: ítems, pagos (sólo venta rápida), historial, adjuntos, reservas, conflictos de identidad.
  delete from public.orders where id = p_id;

  human_code := v_order.human_code;
  storage_paths := v_paths;
  return next;
end;
$$;

revoke all on function public.delete_order_safe(uuid, text, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.delete_order_safe(uuid, text, text, boolean) to authenticated;
