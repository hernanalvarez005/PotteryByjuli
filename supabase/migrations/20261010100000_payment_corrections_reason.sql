-- Corrección de pagos: motivo, RPC transaccional y cierre del DELETE directo.
--
-- La infraestructura de auditoría YA existe y NO se reemplaza: el trigger
-- `payments_log_correction` (AFTER UPDATE, security definer) registra en
-- `payment_corrections` los valores anteriores y nuevos de importe, `paid_at`,
-- método, cuenta, referencia, notas y comisión, con quién y cuándo. La fila original
-- se edita en el lugar (nunca delete + recrear), y `net_amount` es columna generada.
--
-- Lo que faltaba (auditado):
--   1. Motivo de la corrección: `payment_corrections.reason` (opcional, ≤300).
--   2. Una vía que preserve `paid_at` si no cambió y que pase el motivo al trigger:
--      `correct_payment(p_payment_id, p_changes jsonb, p_reason)` — sólo se tocan las
--      CLAVES presentes en `p_changes` (ausente = sin cambio; presente con null = vaciar).
--   3. Borrar un pago borraba también su historial (`payment_corrections` tiene
--      ON DELETE CASCADE) y operations podía hacerlo por la API con la política
--      `FOR ALL`. Se cierra el DELETE directo: la política pasa a INSERT + UPDATE y se
--      revoca el privilegio. (El borrado en cascada desde `delete_order_safe` y los
--      `delete_*_safe` no se ve afectado: corre con los privilegios de su dueño.)
--
-- UPDATE directo por la API sigue permitido a operations/owner (mismo permiso que antes)
-- y sigue auditado por el trigger — sólo que sin motivo. `correct_payment` es la vía
-- recomendada (la que usa la app).

-- 1) Motivo -------------------------------------------------------------------------
alter table public.payment_corrections
  add column reason text check (reason is null or char_length(reason) <= 300);

-- El trigger lee el motivo de una variable de transacción que sólo fija correct_payment.
create or replace function public.log_payment_correction()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text := nullif(btrim(coalesce(current_setting('pottery.payment_correction_reason', true), '')), '');
begin
  if new.amount is distinct from old.amount
     or new.paid_at is distinct from old.paid_at
     or new.method_id is distinct from old.method_id
     or new.account_id is distinct from old.account_id
     or new.reference is distinct from old.reference
     or new.notes is distinct from old.notes
     or new.fee_amount is distinct from old.fee_amount
  then
    insert into public.payment_corrections (payment_id, changed_by, previous_values, new_values, reason)
    values (
      new.id,
      auth.uid(),
      jsonb_build_object(
        'amount', old.amount, 'paid_at', old.paid_at, 'method_id', old.method_id,
        'account_id', old.account_id, 'reference', old.reference, 'notes', old.notes,
        'fee_amount', old.fee_amount
      ),
      jsonb_build_object(
        'amount', new.amount, 'paid_at', new.paid_at, 'method_id', new.method_id,
        'account_id', new.account_id, 'reference', new.reference, 'notes', new.notes,
        'fee_amount', new.fee_amount
      ),
      v_reason
    );
  end if;
  return new;
end;
$$;

-- 2) Corregir un pago -----------------------------------------------------------------
-- SECURITY INVOKER: el RLS de `payments` (UPDATE sólo operations/owner) sigue aplicando.
-- p_changes admite las claves: amount, paid_at, method_id, account_id, reference, notes,
-- fee_amount. Una clave AUSENTE no se toca; una clave presente con null vacía el campo
-- (method_id, account_id, reference, notes). `paid_at` y `amount` no admiten null.
create or replace function public.correct_payment(
  p_payment_id uuid,
  p_changes jsonb,
  p_reason text default null
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_cur public.payments%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_key text;
  v_amount numeric;
  v_fee numeric;
  v_paid_at timestamptz;
  v_method uuid;
  v_account uuid;
  v_reference text;
  v_notes text;
begin
  if not public.is_operations_or_owner() then
    raise exception 'No tenés permiso para corregir pagos.';
  end if;
  if v_reason is not null and char_length(v_reason) > 300 then
    raise exception 'El motivo no puede superar los 300 caracteres.';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'No hay cambios para guardar.';
  end if;
  for v_key in select jsonb_object_keys(p_changes)
  loop
    if v_key not in ('amount', 'paid_at', 'method_id', 'account_id', 'reference', 'notes', 'fee_amount') then
      raise exception 'Campo no corregible: %.', v_key;
    end if;
  end loop;

  -- Bloquea el pago: dos correcciones simultáneas se serializan (y la segunda ve la primera).
  select * into v_cur from public.payments p where p.id = p_payment_id for update;
  if not found then
    raise exception 'El pago no existe.';
  end if;

  v_amount := case when p_changes ? 'amount' then (p_changes ->> 'amount')::numeric else v_cur.amount end;
  v_fee := case when p_changes ? 'fee_amount' then (p_changes ->> 'fee_amount')::numeric else v_cur.fee_amount end;
  v_paid_at := case when p_changes ? 'paid_at' then (p_changes ->> 'paid_at')::timestamptz else v_cur.paid_at end;
  v_method := case when p_changes ? 'method_id' then nullif(p_changes ->> 'method_id', '')::uuid else v_cur.method_id end;
  v_account := case when p_changes ? 'account_id' then nullif(p_changes ->> 'account_id', '')::uuid else v_cur.account_id end;
  v_reference := case when p_changes ? 'reference' then nullif(btrim(p_changes ->> 'reference'), '') else v_cur.reference end;
  v_notes := case when p_changes ? 'notes' then nullif(btrim(p_changes ->> 'notes'), '') else v_cur.notes end;

  if v_amount is null or v_amount <= 0 then
    raise exception 'El importe tiene que ser mayor a 0.';
  end if;
  if v_paid_at is null then
    raise exception 'Falta la fecha del pago.';
  end if;
  if v_fee is null or v_fee < 0 or v_fee > v_amount then
    raise exception 'La comisión no puede ser mayor al importe del pago.';
  end if;
  if char_length(coalesce(v_reference, '')) > 200 then
    raise exception 'La referencia no puede superar los 200 caracteres.';
  end if;
  if char_length(coalesce(v_notes, '')) > 500 then
    raise exception 'La nota no puede superar los 500 caracteres.';
  end if;

  if v_amount is not distinct from v_cur.amount
     and v_fee is not distinct from v_cur.fee_amount
     and v_paid_at is not distinct from v_cur.paid_at
     and v_method is not distinct from v_cur.method_id
     and v_account is not distinct from v_cur.account_id
     and v_reference is not distinct from v_cur.reference
     and v_notes is not distinct from v_cur.notes
  then
    raise exception 'No hay cambios para guardar.';
  end if;

  -- El motivo viaja al trigger (que audita en payment_corrections) por una variable local a
  -- esta transacción; se limpia apenas termina el UPDATE.
  perform set_config('pottery.payment_correction_reason', coalesce(v_reason, ''), true);
  update public.payments
     set amount = v_amount, fee_amount = v_fee, paid_at = v_paid_at,
         method_id = v_method, account_id = v_account, reference = v_reference, notes = v_notes
   where id = p_payment_id;
  perform set_config('pottery.payment_correction_reason', '', true);
end;
$$;

revoke all on function public.correct_payment(uuid, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.correct_payment(uuid, jsonb, text) to authenticated;

-- 3) Sin DELETE directo sobre payments -------------------------------------------------
drop policy if exists "payments_write_operations" on public.payments;

create policy "payments_insert_operations" on public.payments
  for insert to authenticated with check (public.is_operations_or_owner());

create policy "payments_update_operations" on public.payments
  for update to authenticated
  using (public.is_operations_or_owner())
  with check (public.is_operations_or_owner());

revoke delete on public.payments from anon, authenticated;
