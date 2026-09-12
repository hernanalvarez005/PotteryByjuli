-- Auditoría de correcciones a pagos ya registrados (tanda de usabilidad,
-- sección 14) — "Editar pago" (cuotas, y cualquier pago futuro) nunca
-- debe borrar/recrear una fila para simular una edición: se corrige la
-- fila real de `payments` y queda un registro aparte de qué cambió,
-- quién y cuándo. No existía ninguna infraestructura de audit útil para
-- esto — esta es la solución mínima consistente con el patrón ya usado
-- en el resto del dominio (order_status_history: una tabla de historial
-- dedicada, nunca una columna "last_edited_by" que sólo recuerda la
-- última edición).
--
-- Se captura con un trigger, no en cada Server Action que edite un pago
-- — así ninguna futura ruta de edición (hoy sólo updateDuePayment,
-- mañana quizás un pago de pedido) puede "olvidarse" de auditar.

create table public.payment_corrections (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete cascade,
  changed_by uuid references public.profiles (id),
  changed_at timestamptz not null default now(),
  previous_values jsonb not null,
  new_values jsonb not null
);

create index payment_corrections_payment_id_idx on public.payment_corrections (payment_id);

-- security definer: el usuario que corrige un pago necesita permiso para
-- hacer `update` en `payments` (ya lo exige esa RLS), pero nunca necesita
-- (ni debe tener) permiso para insertar directo en payment_corrections —
-- esa tabla es sólo-lectura para todos salvo este trigger.
create or replace function public.log_payment_correction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.amount is distinct from old.amount
     or new.paid_at is distinct from old.paid_at
     or new.method_id is distinct from old.method_id
     or new.account_id is distinct from old.account_id
     or new.reference is distinct from old.reference
     or new.notes is distinct from old.notes
  then
    insert into public.payment_corrections (payment_id, changed_by, previous_values, new_values)
    values (
      new.id,
      auth.uid(),
      jsonb_build_object(
        'amount', old.amount, 'paid_at', old.paid_at, 'method_id', old.method_id,
        'account_id', old.account_id, 'reference', old.reference, 'notes', old.notes
      ),
      jsonb_build_object(
        'amount', new.amount, 'paid_at', new.paid_at, 'method_id', new.method_id,
        'account_id', new.account_id, 'reference', new.reference, 'notes', new.notes
      )
    );
  end if;
  return new;
end;
$$;

create trigger payments_log_correction
  after update on public.payments
  for each row execute function public.log_payment_correction();

alter table public.payment_corrections enable row level security;

create policy "payment_corrections_select_authenticated"
  on public.payment_corrections for select to authenticated using (true);

-- Sin policy de insert/update/delete a propósito: nadie escribe acá
-- directo, sólo el trigger (security definer, no pasa por RLS).
