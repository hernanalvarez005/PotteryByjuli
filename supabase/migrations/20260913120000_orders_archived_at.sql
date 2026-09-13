-- Kanban de Pedidos (Bloque 4 — "Próxima evolución operativa"). El
-- Kanban no es una segunda máquina de estados: sigue siendo
-- orders.status + set_order_status, tal cual. archived_at es sólo un
-- "ocultar sin borrar" para sacar trabajo ya terminado del tablero
-- operativo sin tocar el pedido, su historial ni sus pagos.

alter table public.orders add column archived_at timestamptz;

-- Índice parcial: el Kanban y el listado de Pedidos siempre filtran por
-- "activo" (archived_at is null) agrupando por status — este es
-- exactamente ese acceso, y al ser parcial no pesa nada sobre los
-- pedidos ya archivados.
create index orders_active_by_status_idx on public.orders (operation_type, status)
  where archived_at is null;
