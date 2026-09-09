-- Monthly dues for recurring classes (talleres). Reuses `payments` —
-- never a second ledger — and leans entirely on the unique
-- (enrollment_id, period) constraint already on workshop_dues (Fase 7)
-- for idempotent generation. See docs/business-rules.md § Cuotas
-- mensuales de talleres.

-- ============================================================================
-- 1. Monthly fee — lives on the group, not the program. Every other
-- operational specific (schedule, capacity, location) already lives on
-- workshop_groups; the program is just a category ("Cerámica adultos").
-- Nullable: a group with no fee configured yet is a real, valid state —
-- generate_monthly_dues() below skips it explicitly rather than
-- defaulting to 0.
-- ============================================================================

alter table public.workshop_groups
  add column monthly_fee numeric(12, 2);

-- Optional per-enrollment override (sección 14): workshop_enrollments
-- already has its own `monthly_fee` column since Fase 7 (already wired
-- into the enroll form as "Cuota mensual (opcional)") — that's exactly
-- the override this needs. Reused as-is, no new column.

-- ============================================================================
-- 2. payments becomes reusable for a workshop due, not only an order.
-- Purely additive: existing rows already have order_id set and
-- workshop_due_id null, so they satisfy the new constraint automatically
-- — nothing to backfill, nothing dropped.
-- ============================================================================

alter table public.payments
  alter column order_id drop not null,
  add column workshop_due_id uuid references public.workshop_dues (id) on delete cascade;

alter table public.payments
  add constraint payments_exactly_one_target check (
    (order_id is not null and workshop_due_id is null)
    or (order_id is null and workshop_due_id is not null)
  );

create index payments_workshop_due_id_idx on public.payments (workshop_due_id);

-- ============================================================================
-- 3. workshop_dues: drop the inline is_paid/paid_at/method_id — that was
-- a second, parallel payment record, exactly what sección 18 says not to
-- build. "Pagada"/"Parcial" are always computed from sum(payments),
-- never stored (same rule already governing orders — docs/business-rules
-- § Facturación ≠ cobranza). `status` only carries what ISN'T derivable
-- from payments: whether the due was cancelled.
--
-- 0 rows exist in production today (the generation flow this migration
-- adds is what first makes this table real) — safe to restructure
-- directly instead of carrying the old shape forward.
-- ============================================================================

alter table public.workshop_dues
  drop column is_paid,
  drop column paid_at,
  drop column method_id,
  add column status text not null default 'pending' check (status in ('pending', 'cancelled')),
  add column generated_by uuid references public.profiles (id);

alter table public.workshop_dues
  add constraint workshop_dues_period_format check (period ~ '^\d{4}-\d{2}$');

-- ============================================================================
-- 4. Idempotent monthly generation. INSERT ... ON CONFLICT DO NOTHING
-- against the existing unique(enrollment_id, period) — pressing
-- "Generar cuotas" twice can never double-insert (sección 16).
-- Historical price snapshot (sección 21) falls out for free: `amount` is
-- just a plain column copied at insert time, never recomputed from the
-- group's current monthly_fee afterwards.
-- ============================================================================

create or replace function public.generate_monthly_dues(p_period text)
returns table (created_count integer, skipped_existing integer, skipped_no_fee integer)
language plpgsql
security invoker
as $$
declare
  v_total_with_fee integer;
  v_no_fee integer;
  v_created integer;
begin
  if not (public.is_owner() or public.has_role('operations')) then
    raise exception 'No tenés permiso para generar cuotas.';
  end if;
  if p_period !~ '^\d{4}-\d{2}$' then
    raise exception 'Período inválido — formato esperado AAAA-MM.';
  end if;

  select
    count(*) filter (where coalesce(e.monthly_fee, g.monthly_fee) is not null),
    count(*) filter (where coalesce(e.monthly_fee, g.monthly_fee) is null)
  into v_total_with_fee, v_no_fee
  from public.workshop_enrollments e
  join public.workshop_groups g on g.id = e.group_id
  where e.status = 'active' and g.archived_at is null;

  with inserted as (
    insert into public.workshop_dues (enrollment_id, period, amount, status, generated_by)
    select e.id, p_period, coalesce(e.monthly_fee, g.monthly_fee), 'pending', auth.uid()
    from public.workshop_enrollments e
    join public.workshop_groups g on g.id = e.group_id
    where e.status = 'active' and g.archived_at is null
      and coalesce(e.monthly_fee, g.monthly_fee) is not null
    on conflict (enrollment_id, period) do nothing
    returning id
  )
  select count(*) into v_created from inserted;

  return query select v_created, v_total_with_fee - v_created, v_no_fee;
end;
$$;

grant execute on function public.generate_monthly_dues to authenticated;

-- ============================================================================
-- 5. Cancel a due — the one workshop_dues.status transition the app
-- performs directly (never through a raw update, so it's easy to extend
-- with an audit trail later without hunting down every call site).
-- ============================================================================

create or replace function public.cancel_due(p_id uuid)
returns void
language plpgsql
security invoker
as $$
begin
  if not (public.is_owner() or public.has_role('operations')) then
    raise exception 'No tenés permiso para cancelar cuotas.';
  end if;
  update public.workshop_dues set status = 'cancelled' where id = p_id;
end;
$$;

grant execute on function public.cancel_due to authenticated;
