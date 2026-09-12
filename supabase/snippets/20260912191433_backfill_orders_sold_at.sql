-- Backfill de orders.sold_at para pedidos entregados ANTES de que
-- existiera el trigger orders_set_sold_at (migración
-- 20260912191433_orders_sold_at.sql).
--
-- Deliberadamente separado de esa migración y NUNCA corrido
-- automáticamente — revisar el SELECT de abajo primero, y sólo si el
-- resultado tiene sentido, correr el UPDATE.
--
-- Única fuente de evidencia: MIN(order_status_history.changed_at) para
-- status='delivered', por pedido. Nunca created_at, nunca "hoy", nunca
-- una fecha inventada. Un pedido delivered sin ninguna fila 'delivered'
-- en su historial (no debería existir, dado que el trigger de historial
-- viene desde la primera migración de orders) queda sin sold_at en vez
-- de completarse con un valor sin respaldo.

-- ============================================================================
-- 1) REVISAR PRIMERO — nunca ejecutar el UPDATE de abajo a ciegas.
-- Devuelve, por cada pedido delivered sin sold_at, la fecha que el
-- backfill le asignaría.
-- ============================================================================
select
  o.id,
  o.human_code,
  o.status,
  o.created_at,
  h.first_delivered_at as sold_at_a_asignar
from public.orders o
join (
  select order_id, min(changed_at) as first_delivered_at
  from public.order_status_history
  where status = 'delivered'
  group by order_id
) h on h.order_id = o.id
where o.status = 'delivered' and o.sold_at is null
order by o.created_at;

-- ============================================================================
-- 2) Casos SIN evidencia — pedidos delivered que NO tienen ninguna fila
-- 'delivered' en su historial. Deberían ser cero; si aparece alguno,
-- investigar antes de seguir (no correr el UPDATE de abajo para estos:
-- quedan sin sold_at a propósito, nunca se les inventa una fecha).
-- ============================================================================
select o.id, o.human_code, o.status, o.created_at
from public.orders o
left join public.order_status_history h
  on h.order_id = o.id and h.status = 'delivered'
where o.status = 'delivered' and o.sold_at is null and h.order_id is null;

-- ============================================================================
-- 3) UPDATE real — recién después de revisar (1) y confirmar que (2) da
-- cero filas (o que las filas que dio son un caso ya entendido y
-- aceptado sin sold_at).
-- ============================================================================
-- update public.orders o
-- set sold_at = h.first_delivered_at
-- from (
--   select order_id, min(changed_at) as first_delivered_at
--   from public.order_status_history
--   where status = 'delivered'
--   group by order_id
-- ) h
-- where o.id = h.order_id and o.sold_at is null;
