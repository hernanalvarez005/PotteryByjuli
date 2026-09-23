-- workshop_due_balances (perf audit, P1 — Dashboard/Talleres: cuotas
-- históricas sin filtro por período, 2026-09-24). getDashboardSummary
-- traía TODAS las cuotas de talleres de la historia, sin filtro, para
-- calcular en JS cuáles estaban pendientes/parciales — sin ORDER BY,
-- ya hoy (confirmado con dataset sintético de escala) PostgREST corta
-- el resultado en su límite de página por default (1.000 filas), en un
-- orden no garantizado: "Necesita atención" puede estar mostrando un
-- recorte arbitrario de la historia, no necesariamente la deuda real.
--
-- Esta vista pre-agrega el saldo de cada cuota en el servidor —
-- exactamente la misma fórmula que computeDueSummary/computeDueBalance
-- (lib/workshop-dues.ts), nunca una segunda lógica: base_amount + extras
-- no anulados − pagos, nunca negativo. NUNCA decide pendiente/parcial/
-- pagada — sólo expone los números; computeDueDisplayStatus sigue
-- siendo la única función que decide eso.
--
-- `security_invoker = true`: la vista respeta el RLS de
-- workshop_dues/workshop_due_items/payments según el rol que consulta,
-- nunca los esquiva con los privilegios de quien la creó — si esas
-- políticas se vuelven más restrictivas en el futuro, la vista hereda
-- esa restricción automáticamente.
--
-- extras/pagos se pre-agregan en subqueries agrupadas por due_id/
-- workshop_due_id ANTES del join — nunca un join directo entre las tres
-- tablas, que multiplicaría filas (una cuota con 2 pagos y 3 extras
-- daría 6 filas en vez de 1).

create or replace view public.workshop_due_balances
with (security_invoker = true)
as
select
  d.id as due_id,
  d.enrollment_id,
  d.period,
  d.status,
  d.amount as base_amount,
  coalesce(items.extras_total, 0) as extras_total,
  d.amount + coalesce(items.extras_total, 0) as total_due,
  coalesce(pays.paid_total, 0) as paid_total,
  greatest(d.amount + coalesce(items.extras_total, 0) - coalesce(pays.paid_total, 0), 0) as balance
from public.workshop_dues d
left join (
  select due_id, sum(amount) as extras_total
  from public.workshop_due_items
  where voided_at is null
  group by due_id
) items on items.due_id = d.id
left join (
  select workshop_due_id, sum(amount) as paid_total
  from public.payments
  where workshop_due_id is not null
  group by workshop_due_id
) pays on pays.workshop_due_id = d.id;

grant select on public.workshop_due_balances to authenticated;
