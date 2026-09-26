-- Exención excepcional de la cuota BASE de una alumna (convenio, ausencia
-- prolongada, excepción comercial, compensación, cortesía).
--
-- NO es un pago de $0 ni un pago falso: eximir no inserta nada en `payments`
-- (los ingresos salen sólo de pagos reales), `paid_total` sigue siendo la suma de
-- pagos reales, y la cuota exenta no es "pagada" ni es deuda.
--
-- Modelo: `workshop_due_waivers`, UNA FILA POR CICLO de exención (se abre al
-- eximir, se cierra al quitar). Mismo patrón que `workshop_due_items.voided_at`:
-- el estado "exenta" se DERIVA de la tabla (hay una fila con reverted_at is null),
-- nunca se guarda una segunda copia en `workshop_dues`; el historial es inmutable
-- (sin políticas de insert/update/delete: sólo escriben las RPC).
--
--   * eximir → nueva fila (quién, cuándo, motivo, importe base eximido);
--   * quitar → cierra la fila (quién, cuándo, motivo de la reversión);
--   * eximir de nuevo → OTRA fila: ciclos ilimitados, historial completo;
--   * índice único parcial: a lo sumo UNA exención activa por cuota.
--
-- La exención afecta SÓLO la cuota base: los extras (`workshop_due_items`) siguen
-- siendo cobrables. `workshop_due_balances` replica exactamente la regla de
-- `computeDueSummary` (lib/workshop-dues.ts):
--   total_due = (exenta ? 0 : base) + extras no anulados;  balance = max(total_due − pagos, 0)

create table public.workshop_due_waivers (
  id uuid primary key default gen_random_uuid(),
  due_id uuid not null references public.workshop_dues(id) on delete cascade,
  -- Importe base eximido, congelado al momento (deja explícito qué se perdonó).
  waived_amount numeric(12,2) not null check (waived_amount > 0),
  reason text check (reason is null or char_length(reason) <= 300),
  waived_by uuid references public.profiles(id),
  waived_at timestamptz not null default now(),
  reverted_by uuid references public.profiles(id),
  reverted_at timestamptz,
  revert_reason text check (revert_reason is null or char_length(revert_reason) <= 300),
  constraint workshop_due_waivers_revert_pair check ((reverted_at is null) = (reverted_by is null)),
  constraint workshop_due_waivers_revert_after check (reverted_at is null or reverted_at >= waived_at),
  constraint workshop_due_waivers_revert_reason_needs_revert check (revert_reason is null or reverted_at is not null)
);

-- A lo sumo UNA exención activa por cuota; ciclos ilimitados en el tiempo.
create unique index workshop_due_waivers_one_active_per_due
  on public.workshop_due_waivers (due_id) where reverted_at is null;
create index workshop_due_waivers_due_id_idx on public.workshop_due_waivers (due_id);

alter table public.workshop_due_waivers enable row level security;

-- Lectura para toda usuaria autenticada: el estado derivado tiene que verse igual
-- en todos los roles (si no, un viewer vería como deuda una cuota exenta). El
-- motivo viaja en la misma fila y es visible para todas (decisión aprobada).
create policy "workshop_due_waivers_select_authenticated" on public.workshop_due_waivers
  for select to authenticated using (true);

-- Sin políticas de INSERT/UPDATE/DELETE: el historial no se edita ni se borra por
-- la API; lo escriben sólo waive_due / unwaive_due. (Defensa en profundidad:)
revoke all on public.workshop_due_waivers from anon;
revoke insert, update, delete on public.workshop_due_waivers from authenticated;
grant select on public.workshop_due_waivers to authenticated;

-- Eximir --------------------------------------------------------------------
create or replace function public.waive_due(p_due_id uuid, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_due public.workshop_dues%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id uuid;
begin
  if not public.is_owner() then
    raise exception 'Sólo la administradora puede eximir cuotas.';
  end if;

  -- Bloquea la cuota: un pago concurrente (que toma un lock compartido sobre esta
  -- fila) queda serializado con esta operación — o entra antes y bloquea la
  -- exención, o espera y ve la cuota ya exenta.
  select * into v_due from public.workshop_dues d where d.id = p_due_id for update;
  if not found then
    raise exception 'La cuota no existe.';
  end if;

  if v_due.status = 'cancelled' then
    raise exception 'La cuota está cancelada y no se puede eximir.';
  end if;
  if v_due.amount <= 0 then
    raise exception 'La cuota no tiene importe base para eximir.';
  end if;
  if exists (select 1 from public.workshop_due_waivers w where w.due_id = p_due_id and w.reverted_at is null) then
    raise exception 'La cuota ya está exenta.';
  end if;
  -- Cualquier pago existente bloquea: los pagos se registran contra el TOTAL de la
  -- cuota, así que no se puede saber si cubrieron la base o un extra. Hay que
  -- resolverlo antes en vez de eximir en silencio.
  if exists (select 1 from public.payments p where p.workshop_due_id = p_due_id) then
    raise exception 'Esta cuota ya tiene pagos registrados. Resolvelo antes de eximirla.';
  end if;
  if v_reason is not null and char_length(v_reason) > 300 then
    raise exception 'El motivo no puede superar los 300 caracteres.';
  end if;

  insert into public.workshop_due_waivers (due_id, waived_amount, reason, waived_by)
  values (p_due_id, v_due.amount, v_reason, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

-- Quitar la exención ----------------------------------------------------------
-- Siempre es posible: el estado es derivado, así que volver a cobrar la base nunca
-- genera una inconsistencia con pagos de extras existentes (la cuota pasa a
-- "Pendiente"/"Parcial" según corresponda). CIERRA el ciclo; no borra la fila.
create or replace function public.unwaive_due(p_due_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_waiver_id uuid;
begin
  if not public.is_owner() then
    raise exception 'Sólo la administradora puede quitar una exención.';
  end if;

  perform 1 from public.workshop_dues d where d.id = p_due_id for update;
  if not found then
    raise exception 'La cuota no existe.';
  end if;
  if v_reason is not null and char_length(v_reason) > 300 then
    raise exception 'El motivo no puede superar los 300 caracteres.';
  end if;

  select w.id into v_waiver_id
    from public.workshop_due_waivers w where w.due_id = p_due_id and w.reverted_at is null for update;
  if v_waiver_id is null then
    raise exception 'La cuota no tiene una exención activa.';
  end if;

  update public.workshop_due_waivers
     set reverted_at = now(), reverted_by = auth.uid(), revert_reason = v_reason
   where id = v_waiver_id;
end;
$$;

revoke execute on function public.waive_due(uuid, text) from public, anon;
revoke execute on function public.unwaive_due(uuid, text) from public, anon;
grant execute on function public.waive_due(uuid, text) to authenticated;
grant execute on function public.unwaive_due(uuid, text) to authenticated;

-- Vista de saldos: misma regla que computeDueSummary ---------------------------
-- Las columnas existentes conservan nombre, orden y tipo; `total_due` y `balance`
-- ahora descuentan la base de una cuota con exención ACTIVA. Se agrega `base_waived`
-- AL FINAL para que los consumidores actuales no se rompan.
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
  (case when w.due_id is not null then 0::numeric else d.amount::numeric end) + coalesce(items.extras_total, 0) as total_due,
  coalesce(pays.paid_total, 0) as paid_total,
  greatest(
    (case when w.due_id is not null then 0::numeric else d.amount::numeric end)
      + coalesce(items.extras_total, 0) - coalesce(pays.paid_total, 0),
    0::numeric
  ) as balance,
  (w.due_id is not null) as base_waived
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
) pays on pays.workshop_due_id = d.id
left join (
  -- Una fila por cuota como máximo (índice único parcial): no multiplica filas.
  select due_id from public.workshop_due_waivers where reverted_at is null
) w on w.due_id = d.id;

-- Pagos sobre una cuota EXENTA sin saldo -----------------------------------------
-- Se acota EXCLUSIVAMENTE a pagos de cuota: `payments_exactly_one_target` garantiza
-- que `workshop_due_id is not null` ⇔ el pago es de una cuota (nunca de un pedido),
-- y la cláusula WHEN evita que el trigger siquiera se dispare para pedidos, ventas
-- rápidas u otros flujos. Sólo INSERT: no altera correcciones de pagos existentes.
create or replace function public.reject_payment_on_settled_waived_due()
returns trigger
language plpgsql
as $$
declare
  v_waived boolean;
  v_balance numeric;
begin
  -- Lock compartido sobre la cuota ANTES de leer: si waive_due está en curso
  -- (FOR UPDATE), espera y lee la exención ya confirmada; si este pago entra
  -- primero, waive_due esperará y verá el pago (y se negará a eximir).
  perform 1 from public.workshop_dues d where d.id = new.workshop_due_id for share;

  select b.base_waived, b.balance into v_waived, v_balance
    from public.workshop_due_balances b where b.due_id = new.workshop_due_id;

  if coalesce(v_waived, false) and coalesce(v_balance, 0) <= 0 then
    raise exception 'La cuota está exenta y no tiene saldo por cobrar.';
  end if;
  return new;
end;
$$;

create trigger payments_reject_settled_waived_due
  before insert on public.payments
  for each row
  when (new.workshop_due_id is not null)
  execute function public.reject_payment_on_settled_waived_due();
