-- Phase 9.5 — Calendar, public workshops, and safe delete/archive
-- Deliberately NOT a parallel system: the calendar is a read-only view
-- over workshop_groups (existing recurring classes), events (existing
-- workshops/fairs), and the one new table this migration adds
-- (special_dates, for things that don't belong to either). See
-- docs/business-rules.md and docs/architecture.md for the full writeup.

-- ============================================================================
-- 1. Recurring classes get a structured weekly slot (weekday + time), on
-- top of the free-text `schedule` label already there (kept for display).
-- Single day per group — matches how groups are already modeled ("Grupo
-- martes 18:00"); a group meeting on multiple days is a future extension,
-- not something to force in now.
-- ============================================================================

alter table public.workshop_groups
  add column weekday smallint check (weekday between 1 and 7), -- 1=Monday .. 7=Sunday (ISO 8601)
  add column start_time time,
  add column end_time time,
  add column archived_at timestamptz;

-- ============================================================================
-- 2. Transfer payment details on payment_accounts — reused by workshops
-- (and anything else later), never duplicated per-event.
-- ============================================================================

alter table public.payment_accounts
  add column alias text,
  add column holder_name text;

-- ============================================================================
-- 3. Events (workshops/fairs): richer lifecycle + public-page fields.
-- New status set replaces the Fase 8 one — draft/published/full are new
-- concepts, `completed`/`cancelled` carry over unchanged, `archived` is
-- new. Re-typing the column (not ALTER TYPE ADD VALUE) to avoid the
-- same-transaction "unsafe use of new enum value" restriction entirely.
-- ============================================================================

create type public.workshop_status as enum
  ('draft', 'published', 'full', 'completed', 'cancelled', 'archived');

alter table public.events alter column status drop default;
alter table public.events alter column status type public.workshop_status using (
  case status::text
    when 'planned' then 'draft'
    when 'confirmed' then 'published'
    when 'completed' then 'completed'
    when 'cancelled' then 'cancelled'
    else 'draft'
  end
)::public.workshop_status;
alter table public.events alter column status set default 'draft';
drop type public.event_status;

alter table public.events
  add column slug text,
  add column description text,
  add column start_time time,
  add column end_time time,
  add column address text,
  add column image_path text,
  add column additional_info text,
  add column payment_account_id uuid references public.payment_accounts (id),
  add column is_registration_open boolean not null default true,
  add column archived_at timestamptz;

-- Unique only where set — a draft can exist without one yet; the app
-- blocks publishing without a slug (see wholesale-style app-layer checks).
create unique index events_slug_key on public.events (slug) where slug is not null;

-- ============================================================================
-- Status history for events — same auto-log-on-change pattern as orders
-- (Fase 3) and production_orders (Fase 6). Covers "cambiar estado" from
-- sección 55; capacity/price field-level audit is explicitly out of scope
-- for this pass (see docs/roadmap.md).
-- ============================================================================

create table public.event_status_history (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  status public.workshop_status not null,
  changed_by uuid references public.profiles (id),
  changed_at timestamptz not null default now()
);

create or replace function public.log_event_status_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.event_status_history (event_id, status, changed_by)
  values (new.id, new.status, auth.uid());
  return new;
end;
$$;

create or replace function public.log_event_status_on_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into public.event_status_history (event_id, status, changed_by)
    values (new.id, new.status, auth.uid());
  end if;
  return new;
end;
$$;

create trigger events_log_status_insert
  after insert on public.events
  for each row execute function public.log_event_status_on_insert();

create trigger events_log_status_update
  after update of status on public.events
  for each row execute function public.log_event_status_on_update();

-- ============================================================================
-- 4. Registrations: separate "did they keep their spot" from "did they
-- pay" (sección 16-17) — two independent axes, exactly like orders vs.
-- payments elsewhere in this schema. participant_name covers kids
-- workshops (contact ≠ participant) without a second customer record.
-- ============================================================================

create type public.event_registration_status as enum
  ('pending', 'confirmed', 'cancelled', 'attended', 'no_show');
create type public.event_payment_status as enum ('pending', 'partial', 'paid');

alter table public.event_registrations alter column status drop default;
alter table public.event_registrations alter column status type public.event_registration_status using (
  case status::text when 'registered' then 'confirmed' else 'cancelled' end
)::public.event_registration_status;
alter table public.event_registrations alter column status set default 'confirmed';
drop type public.registration_status;

alter table public.event_registrations
  add column participant_name text,
  add column payment_status public.event_payment_status not null default 'pending';

update public.event_registrations set payment_status = 'paid' where is_paid;
alter table public.event_registrations drop column is_paid;
-- paid_at is kept as-is: "last time a payment was recorded" regardless of
-- partial/full — still useful, no need to rename.

create table public.event_registration_status_history (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.event_registrations (id) on delete cascade,
  status public.event_registration_status not null,
  changed_by uuid references public.profiles (id),
  changed_at timestamptz not null default now()
);

create or replace function public.log_registration_status_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.event_registration_status_history (registration_id, status, changed_by)
  values (new.id, new.status, auth.uid());
  return new;
end;
$$;

create or replace function public.log_registration_status_on_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into public.event_registration_status_history (registration_id, status, changed_by)
    values (new.id, new.status, auth.uid());
  end if;
  return new;
end;
$$;

create trigger event_registrations_log_status_insert
  after insert on public.event_registrations
  for each row execute function public.log_registration_status_on_insert();

create trigger event_registrations_log_status_update
  after update of status on public.event_registrations
  for each row execute function public.log_registration_status_on_update();

-- Recompute the capacity check to only count spots that are actually held
-- (confirmed/attended — not pending/cancelled/no_show).
create or replace function public.check_event_capacity()
returns trigger
language plpgsql
as $$
declare
  v_capacity integer;
  v_held integer;
begin
  if new.status not in ('confirmed', 'attended') then
    return new;
  end if;

  select capacity into v_capacity from public.events where id = new.event_id;
  if v_capacity is null then
    return new;
  end if;

  select coalesce(sum(quantity), 0) into v_held
  from public.event_registrations
  where event_id = new.event_id and status in ('confirmed', 'attended')
    and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if v_held + new.quantity > v_capacity then
    raise exception 'No hay cupo suficiente (disponible: %, pedido: %).', v_capacity - v_held, new.quantity;
  end if;

  return new;
end;
$$;

-- ============================================================================
-- 5. Special dates — Día de la Madre, lanzamientos, recordatorios. NOT a
-- backdoor for talleres/workshops; those keep their own tables.
-- ============================================================================

create table public.special_dates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  date date not null,
  description text,
  category text,
  is_all_day boolean not null default true,
  recurs_yearly boolean not null default false,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_special_dates_updated_at
  before update on public.special_dates
  for each row execute function public.set_updated_at();

create index special_dates_date_idx on public.special_dates (date);

alter table public.special_dates enable row level security;
create policy "special_dates_select_authenticated"
  on public.special_dates for select to authenticated using (true);
create policy "special_dates_write_operations"
  on public.special_dates for all to authenticated
  using (public.is_operations_or_owner()) with check (public.is_operations_or_owner());

-- ============================================================================
-- 6. register_for_workshop — the only way `anon` touches this part of the
-- schema. `for update` locks the event row so two near-simultaneous
-- registrations for the last spot serialize instead of racing — the
-- second one re-checks capacity after the first commits, exactly the
-- guarantee sección 19 asks for. Same find-or-create-customer +
-- server-computed price pattern as submit_wholesale_request (Fase 5).
-- ============================================================================

create or replace function public.register_for_workshop(
  p_event_id uuid,
  p_first_name text,
  p_last_name text,
  p_whatsapp text,
  p_email text,
  p_participant_name text,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_customer_id uuid;
  v_held integer;
  v_registration_id uuid;
begin
  if p_first_name is null or length(trim(p_first_name)) = 0 then
    raise exception 'Falta el nombre.';
  end if;
  if p_whatsapp is null or length(trim(p_whatsapp)) = 0 then
    raise exception 'Falta un WhatsApp de contacto.';
  end if;

  select * into v_event from public.events where id = p_event_id for update;
  if v_event.id is null then
    raise exception 'Workshop no encontrado.';
  end if;
  if v_event.event_type <> 'workshop' then
    raise exception 'Este evento no admite inscripción pública.';
  end if;
  if v_event.status not in ('published', 'full') or not v_event.is_registration_open then
    raise exception 'Las inscripciones para este workshop no están abiertas.';
  end if;

  if v_event.capacity is not null then
    select coalesce(sum(quantity), 0) into v_held
    from public.event_registrations
    where event_id = p_event_id and status in ('confirmed', 'attended');

    if v_held >= v_event.capacity then
      raise exception 'Cupo completo.';
    end if;
  end if;

  select id into v_customer_id from public.customers
  where (whatsapp is not null and whatsapp = p_whatsapp)
     or (p_email is not null and length(trim(p_email)) > 0 and email = p_email)
  limit 1;

  if v_customer_id is null then
    insert into public.customers (first_name, last_name, whatsapp, email)
    values (p_first_name, p_last_name, p_whatsapp, p_email)
    returning id into v_customer_id;
  end if;

  insert into public.event_registrations
    (event_id, customer_id, participant_name, quantity, unit_price, status, payment_status, notes)
  values
    (p_event_id, v_customer_id, p_participant_name, 1, v_event.price, 'confirmed', 'pending', p_notes)
  returning id into v_registration_id;

  -- Flip to 'full' the moment the last spot is taken, so the backoffice
  -- list reflects it without anyone having to notice and set it by hand.
  if v_event.capacity is not null and v_held + 1 >= v_event.capacity then
    update public.events set status = 'full' where id = p_event_id and status = 'published';
  end if;

  return jsonb_build_object(
    'registration_id', v_registration_id,
    'event_name', v_event.name,
    'event_date', v_event.event_date,
    'price', v_event.price
  );
end;
$$;

grant execute on function public.register_for_workshop to anon, authenticated;

-- ============================================================================
-- 7. Safe delete — hard delete only when an entity has zero real history;
-- otherwise archive/cancel, never destroy. Sección 38-43.
-- ============================================================================

create or replace function public.delete_customer_safe(p_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
  v_orders integer;
  v_enrollments integer;
  v_registrations integer;
begin
  if not public.is_owner() then
    raise exception 'Sólo la administradora puede eliminar definitivamente.';
  end if;

  select count(*) into v_orders from public.orders where customer_id = p_id;
  select count(*) into v_enrollments from public.workshop_enrollments where customer_id = p_id;
  select count(*) into v_registrations from public.event_registrations where customer_id = p_id;

  if v_orders > 0 or v_enrollments > 0 or v_registrations > 0 then
    raise exception
      'No se puede eliminar: tiene % pedido(s), % inscripción(es) a taller y % inscripción(es) a evento. Archivalo en su lugar.',
      v_orders, v_enrollments, v_registrations;
  end if;

  delete from public.customers where id = p_id;
end;
$$;

grant execute on function public.delete_customer_safe to authenticated;

create or replace function public.delete_workshop_group_safe(p_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
  v_enrollments integer;
begin
  if not public.is_owner() then
    raise exception 'Sólo la administradora puede eliminar definitivamente.';
  end if;

  select count(*) into v_enrollments from public.workshop_enrollments where group_id = p_id;
  if v_enrollments > 0 then
    raise exception 'No se puede eliminar: tiene % alumno(s) asociado(s). Archivalo en su lugar.', v_enrollments;
  end if;
  delete from public.workshop_groups where id = p_id;
end;
$$;

grant execute on function public.delete_workshop_group_safe to authenticated;

create or replace function public.delete_event_safe(p_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
  v_registrations integer;
  v_orders integer;
  v_transfers integer;
begin
  if not public.is_owner() then
    raise exception 'Sólo la administradora puede eliminar definitivamente.';
  end if;

  select count(*) into v_registrations from public.event_registrations where event_id = p_id;
  select count(*) into v_orders from public.orders where event_id = p_id;
  select count(*) into v_transfers from public.stock_transfers where event_id = p_id;
  if v_registrations > 0 or v_orders > 0 or v_transfers > 0 then
    raise exception
      'No se puede eliminar: tiene % inscripción(es), % venta(s) y % transferencia(s) de stock asociadas. Cancelalo o archivalo en su lugar.',
      v_registrations, v_orders, v_transfers;
  end if;
  delete from public.events where id = p_id;
end;
$$;

grant execute on function public.delete_event_safe to authenticated;

create or replace function public.delete_enrollment_safe(p_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
  v_attendance integer;
  v_dues integer;
begin
  if not public.is_owner() then
    raise exception 'Sólo la administradora puede eliminar definitivamente.';
  end if;

  select count(*) into v_attendance from public.attendance_records where enrollment_id = p_id;
  select count(*) into v_dues from public.workshop_dues where enrollment_id = p_id;
  if v_attendance > 0 or v_dues > 0 then
    raise exception 'No se puede eliminar: tiene asistencia o cuotas registradas. Dá de baja en su lugar.';
  end if;
  delete from public.workshop_enrollments where id = p_id;
end;
$$;

grant execute on function public.delete_enrollment_safe to authenticated;

create or replace function public.delete_registration_safe(p_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
  v_payment_status public.event_payment_status;
begin
  if not public.is_owner() then
    raise exception 'Sólo la administradora puede eliminar definitivamente.';
  end if;

  select payment_status into v_payment_status from public.event_registrations where id = p_id;
  if v_payment_status is null then
    raise exception 'Inscripción no encontrada.';
  end if;
  if v_payment_status <> 'pending' then
    raise exception 'No se puede eliminar: ya tiene un pago registrado. Cancelala en su lugar.';
  end if;
  delete from public.event_registrations where id = p_id;
end;
$$;

grant execute on function public.delete_registration_safe to authenticated;

-- ============================================================================
-- 8. Public views — the anon-safe slice of events/payment_accounts.
-- Views run with the defining role's privileges by default (this
-- migration runs as the project owner, who bypasses RLS as table owner),
-- so the WHERE clause here — not RLS — is what limits rows; anon only
-- ever gets SELECT on the view, never on the base tables.
-- ============================================================================

-- confirmed_count is an aggregate, never individual rows/names — the view
-- (owner-context) can read event_registrations for it even though anon
-- has no grant on that table at all (sección 21: "no exponer nombres,
-- sólo 'X lugares disponibles'").
create view public.workshop_public_view
with (security_invoker = false)
as
select
  e.id, e.slug, e.name, e.description, e.event_date, e.start_time, e.end_time,
  e.location_id, e.address, e.price, e.capacity, e.image_path, e.additional_info,
  e.payment_account_id, e.status, e.is_registration_open,
  (
    select coalesce(sum(er.quantity), 0)::integer
    from public.event_registrations er
    where er.event_id = e.id and er.status in ('confirmed', 'attended')
  ) as confirmed_count
from public.events e
where e.event_type = 'workshop'
  and e.status in ('published', 'full')
  and e.slug is not null;

grant select on public.workshop_public_view to anon, authenticated;

create view public.payment_account_public_view
with (security_invoker = false)
as
select id, name, alias, holder_name, account_type
from public.payment_accounts
where is_active;

grant select on public.payment_account_public_view to anon, authenticated;

-- locations has no anon select policy yet (Fase 1 kept it staff-only) —
-- the public workshop page needs a location's name/city, nothing else.
create view public.location_public_view
with (security_invoker = false)
as
select id, name, city, province from public.locations where is_active;

grant select on public.location_public_view to anon, authenticated;

-- ============================================================================
-- 9. Storage bucket for workshop cover images — public, same pattern as
-- product-images (Fase 2): the public workshop page needs it to load
-- without a session.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('event-images', 'event-images', true)
on conflict (id) do nothing;

create policy "event_images_public_read"
  on storage.objects for select
  using (bucket_id = 'event-images');

create policy "event_images_write_workshop_staff"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'event-images' and public.is_workshop_staff_or_above())
  with check (bucket_id = 'event-images' and public.is_workshop_staff_or_above());

-- ============================================================================
-- Row Level Security — event_registrations stays exactly as strict as
-- before (staff-only; anon never reads or writes it directly, only
-- through register_for_workshop). No new anon policy on `events` or
-- `payment_accounts` either — the views above are the only public path.
-- ============================================================================
