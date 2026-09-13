-- Calendario + recordatorios (Bloque 7 — "Próxima evolución operativa").
-- Un recordatorio puede vincularse a una fecha especial ya cargada, pero
-- nunca la duplica: sólo guarda su id (special_date_id), la fecha real
-- sigue viviendo únicamente en special_dates.

create table public.calendar_reminders (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  remind_at date not null,
  status text not null default 'pending' check (status in ('pending', 'completed')),
  special_date_id uuid references public.special_dates (id),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index calendar_reminders_remind_at_idx on public.calendar_reminders (remind_at);

-- Mismo nivel que special_dates (Fase 9.5): lectura para cualquier
-- autenticado (es agenda operativa compartida, no un dato financiero
-- sensible), escritura sólo dueña + operaciones.
alter table public.calendar_reminders enable row level security;

create policy "calendar_reminders_select_authenticated"
  on public.calendar_reminders for select to authenticated using (true);
create policy "calendar_reminders_write_operations"
  on public.calendar_reminders for all to authenticated
  using (public.is_operations_or_owner()) with check (public.is_operations_or_owner());
