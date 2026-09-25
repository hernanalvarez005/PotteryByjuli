-- "Pendiente de cobrar" de /pedidos: saldo real por pedido + agregación en el servidor.
--
-- Hoy el saldo de un pedido se calcula por fila en la página (`total - paid`,
-- con `paid` sumado sólo de los pedidos que se muestran). Eso sirve para una
-- fila, no para un TOTAL de toda la cartera: sumar `orders.total` daría "lo
-- vendido", no "lo que falta cobrar" (docs/business-rules.md § Facturación ≠
-- cobranza), y traer todos los pagos para sumarlos en JS repetiría el error de
-- H-02/H-12 (tope silencioso de 1.000 filas de PostgREST, URLs enormes).
--
-- `order_balances` expone, por pedido, `paid_total` y `balance = max(total -
-- pagado, 0)` — el mismo criterio que `workshop_due_balances`: un pedido
-- sobrepagado no compensa a otro. NO decide qué es "por cobrar": eso lo
-- decide `get_orders_receivable`.
--
-- `security_invoker = true`: respeta el RLS de orders/payments según quien
-- consulta. Los pagos se pre-agregan por pedido ANTES del join (nunca un join
-- directo que multiplique filas).

create or replace view public.order_balances
with (security_invoker = true)
as
select
  o.id as order_id,
  o.business_unit_id,
  o.operation_type,
  o.status,
  o.archived_at,
  o.total,
  coalesce(pays.paid_total, 0) as paid_total,
  greatest(o.total - coalesce(pays.paid_total, 0), 0) as balance
from public.orders o
left join (
  select order_id, sum(amount) as paid_total
  from public.payments
  where order_id is not null
  group by order_id
) pays on pays.order_id = o.id;

-- Supabase concede por defecto privilegios sobre tablas/vistas nuevas a `anon`:
-- se retiran (el RLS ya devolvería 0 filas, pero no hace falta ni exponerla).
revoke all on public.order_balances from anon;
grant select on public.order_balances to authenticated;

-- Cartera por cobrar, agregada en el servidor. UNA sola fuente de verdad para
-- Lista, Kanban y cualquier filtro por unidad de negocio.
--
-- Universo (decisiones aprobadas):
--   * operation_type = 'order'    → el mismo universo que la pantalla de Pedidos
--   * status <> 'cancelled'       → un pedido cancelado no es una cuenta por cobrar
--   * balance > 0                 → sólo lo que realmente se debe
--   * INCLUYE pedidos `pending`   → coherente con la columna "Saldo" de la Lista
--   * INCLUYE archivados          → archivar es un concepto de tablero, no de deuda
--   * INCLUYE entregados con deuda→ el KPI es financiero, no de producción
-- `p_business_unit_id` null = todas las unidades.
--
-- Devuelve además el desglose de lo que una vista puede NO estar mostrando
-- (archivados y sin confirmar) para que la pantalla lo aclare en vez de dejar
-- un total que parezca inconsistente con las filas visibles.
create or replace function public.get_orders_receivable(p_business_unit_id uuid default null)
returns table (
  pending_total numeric,
  orders_count bigint,
  archived_pending_total numeric,
  archived_orders_count bigint,
  unconfirmed_pending_total numeric,
  unconfirmed_orders_count bigint
)
language sql
stable
security invoker
as $$
  select
    coalesce(sum(b.balance), 0),
    count(*),
    coalesce(sum(b.balance) filter (where b.archived_at is not null), 0),
    count(*) filter (where b.archived_at is not null),
    coalesce(sum(b.balance) filter (where b.status = 'pending'), 0),
    count(*) filter (where b.status = 'pending')
  from public.order_balances b
  where b.operation_type = 'order'
    and b.status <> 'cancelled'
    and b.balance > 0
    and (p_business_unit_id is null or b.business_unit_id = p_business_unit_id);
$$;

-- Postgres concede EXECUTE a PUBLIC por defecto: sólo usuarias autenticadas.
revoke execute on function public.get_orders_receivable(uuid) from public, anon;
grant execute on function public.get_orders_receivable(uuid) to authenticated;
