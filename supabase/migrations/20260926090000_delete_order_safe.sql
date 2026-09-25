-- Eliminación segura de pedidos cargados por error.
--
-- Hasta ahora `orders` no se podía borrar desde la app (historial por diseño),
-- pero la política RLS `orders_write_operations` era FOR ALL: un DELETE directo
-- por la API estaba permitido a operations/owner y CASCADEABA los pagos
-- (`payments.order_id ... ON DELETE CASCADE`), las reservas, los ítems y el
-- historial, dejando además movimientos de stock huérfanos (referencia
-- polimórfica, sin FK) y órdenes de producción con `order_id = NULL`.
--
-- Esta migración:
--   1. Quita el DELETE directo sobre `orders` (INSERT/UPDATE conservan sus
--      permisos actuales: operations u owner). La única vía de borrado pasa a
--      ser `delete_order_safe`, que no se puede saltear por la API.
--   2. `classify_order_for_delete`: sólo lectura, dice si un pedido se puede
--      borrar y por qué no. Es la ÚNICA fuente de la regla y del mensaje.
--   3. `delete_order_safe`: borra en UNA transacción, sólo owner, y deja
--      registro en `order_deletions`.
--
-- Regla de elegibilidad (por relaciones reales, no sólo por estado). Se puede
-- borrar sólo si el pedido NO tiene consecuencias operativas ni financieras:
--   * 0 pagos                                   (dinero registrado)
--   * 0 movimientos de stock del pedido          (inventory_movements.reference_id)
--   * 0 órdenes de producción                    (production_orders.order_id)
--   * no está entregado                          (entrega = hecho consumado)
--   * no proviene del checkout mayorista         (es una solicitud real de un cliente)
-- Las reservas activas y el historial de estados NO bloquean: son estado
-- transitorio/derivado y se van con el pedido (cascada).
-- Un pedido no elegible se CANCELA (set_order_status), nunca se borra.
--
-- Storage (PDF adjuntos) no forma parte de la transacción de Postgres:
-- `delete_order_safe` devuelve las rutas y la app borra los archivos DESPUÉS
-- del commit (un archivo huérfano es inocuo: bucket privado, ruta con el uuid).
--
-- Nota: el número de pedido sale de una secuencia; el código de un pedido
-- borrado no se reutiliza y queda un hueco en la numeración.

-- 1) RLS: sin DELETE directo -------------------------------------------------
drop policy if exists "orders_write_operations" on public.orders;

create policy "orders_insert_operations" on public.orders
  for insert to authenticated
  with check (public.is_operations_or_owner());

create policy "orders_update_operations" on public.orders
  for update to authenticated
  using (public.is_operations_or_owner())
  with check (public.is_operations_or_owner());

-- 2) Registro de eliminaciones (append-only) ----------------------------------
create table if not exists public.order_deletions (
  id uuid primary key default gen_random_uuid(),
  -- Sin FK a propósito: el pedido ya no existe, y una FK a customers bloquearía
  -- delete_customer_safe por una fila de auditoría.
  order_id uuid not null,
  human_code text not null,
  business_unit_id uuid references public.business_units(id),
  customer_id uuid,
  status public.order_status not null,
  total numeric(12,2) not null,
  item_count integer not null,
  order_created_at timestamptz not null,
  reason text check (reason is null or char_length(reason) <= 300),
  deleted_by uuid references public.profiles(id),
  deleted_at timestamptz not null default now()
);

create index if not exists order_deletions_deleted_at_idx on public.order_deletions (deleted_at desc);

alter table public.order_deletions enable row level security;

-- Sólo la owner lo lee. Sin políticas de INSERT/UPDATE/DELETE: lo escribe
-- únicamente delete_order_safe (security definer) y nadie lo modifica.
create policy "order_deletions_select_owner" on public.order_deletions
  for select to authenticated
  using (public.is_owner());

-- 3) Clasificación (sólo lectura) ---------------------------------------------
create or replace function public.classify_order_for_delete(p_id uuid)
returns table (
  order_id uuid,
  human_code text,
  status public.order_status,
  payments_count integer,
  movements_count integer,
  production_orders_count integer,
  from_checkout boolean,
  deletable boolean,
  block_message text
)
language plpgsql
stable
security invoker
as $$
declare
  v_order public.orders%rowtype;
  v_payments integer;
  v_movements integer;
  v_production integer;
  v_checkout boolean;
  v_suffix text;
begin
  select * into v_order from public.orders o where o.id = p_id;
  if not found then
    raise exception 'El pedido no existe.';
  end if;

  select count(*) into v_payments from public.payments p where p.order_id = p_id;
  select count(*) into v_movements
    from public.inventory_movements m where m.reference_table = 'orders' and m.reference_id = p_id;
  select count(*) into v_production from public.production_orders po where po.order_id = p_id;
  v_checkout := v_order.wholesale_buyer_snapshot is not null or v_order.wholesale_terms_snapshot is not null;

  -- "Podés cancelarlo" sólo si cancelar es posible (no entregado/cancelado).
  v_suffix := case when v_order.status in ('delivered', 'cancelled') then '' else ' Podés cancelarlo.' end;

  order_id := v_order.id;
  human_code := v_order.human_code;
  status := v_order.status;
  payments_count := v_payments;
  movements_count := v_movements;
  production_orders_count := v_production;
  from_checkout := v_checkout;

  if v_order.status = 'delivered' then
    deletable := false;
    block_message := 'Este pedido ya fue entregado y no puede eliminarse.';
  elsif v_checkout then
    deletable := false;
    block_message := 'Este pedido es una solicitud del checkout mayorista y no puede eliminarse.' || v_suffix;
  elsif v_payments > 0 or v_movements > 0 or v_production > 0 then
    deletable := false;
    block_message := 'Este pedido ya tiene movimientos asociados y no puede eliminarse.' || v_suffix;
  else
    deletable := true;
    block_message := null;
  end if;

  return next;
end;
$$;

grant execute on function public.classify_order_for_delete to authenticated;

-- 4) Eliminación transaccional -------------------------------------------------
-- SECURITY DEFINER porque tras quitar el DELETE de la política de `orders` es la
-- única vía de borrado; el permiso se verifica ADENTRO (sólo owner) y la regla es
-- la de classify_order_for_delete, re-evaluada con el pedido bloqueado.
create or replace function public.delete_order_safe(p_id uuid, p_reason text default null)
returns table (human_code text, storage_paths text[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_check record;
  v_items integer;
  v_paths text[];
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_owner() then
    raise exception 'Sólo la administradora puede eliminar pedidos.';
  end if;

  -- Bloquea el pedido: un pago o un cambio de estado concurrente espera a que
  -- termine esta transacción (o ya está confirmado y lo ve el chequeo de abajo).
  select * into v_order from public.orders o where o.id = p_id for update;
  if not found then
    raise exception 'El pedido no existe.';
  end if;

  select * into v_check from public.classify_order_for_delete(p_id);
  if not v_check.deletable then
    raise exception '%', v_check.block_message;
  end if;

  if v_reason is not null and char_length(v_reason) > 300 then
    raise exception 'El motivo no puede superar los 300 caracteres.';
  end if;

  select count(*) into v_items from public.order_items oi where oi.order_id = p_id;
  select coalesce(array_agg(a.storage_path), '{}') into v_paths
    from public.order_attachments a where a.order_id = p_id;

  insert into public.order_deletions
    (order_id, human_code, business_unit_id, customer_id, status, total, item_count, order_created_at, reason, deleted_by)
  values
    (v_order.id, v_order.human_code, v_order.business_unit_id, v_order.customer_id, v_order.status,
     v_order.total, v_items, v_order.created_at, v_reason, auth.uid());

  -- Cascada: ítems, historial, adjuntos, reservas, conflictos de identidad.
  delete from public.orders where id = p_id;

  human_code := v_order.human_code;
  storage_paths := v_paths;
  return next;
end;
$$;

grant execute on function public.delete_order_safe to authenticated;
