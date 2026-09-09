-- Phase 7 — Recurring workshops (talleres)
-- Students are customers — never a separate "student" table. Enrollment
-- links a customer to a group; attendance and dues hang off the
-- enrollment. See docs/business-rules.md.

create or replace function public.is_workshop_staff_or_above()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_owner()
    or public.has_role('operations')
    or public.has_role('workshop_staff');
$$;

create table public.workshop_programs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_workshop_programs_updated_at
  before update on public.workshop_programs
  for each row execute function public.set_updated_at();

create table public.workshop_groups (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.workshop_programs (id) on delete cascade,
  location_id uuid references public.locations (id),
  name text not null,
  schedule text,
  capacity integer not null check (capacity > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_workshop_groups_updated_at
  before update on public.workshop_groups
  for each row execute function public.set_updated_at();

create type public.enrollment_status as enum ('active', 'paused', 'cancelled');

create table public.workshop_enrollments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.workshop_groups (id) on delete cascade,
  customer_id uuid not null references public.customers (id),
  status public.enrollment_status not null default 'active',
  start_date date not null default current_date,
  monthly_fee numeric(12, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, customer_id)
);

create trigger set_workshop_enrollments_updated_at
  before update on public.workshop_enrollments
  for each row execute function public.set_updated_at();

-- Only a currently-active enrollment counts against capacity.
create or replace function public.check_workshop_capacity()
returns trigger
language plpgsql
as $$
declare
  v_capacity integer;
  v_active_count integer;
begin
  if new.status <> 'active' then
    return new;
  end if;

  select capacity into v_capacity from public.workshop_groups where id = new.group_id;

  select count(*) into v_active_count
  from public.workshop_enrollments
  where group_id = new.group_id and status = 'active' and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if v_active_count >= v_capacity then
    raise exception 'El grupo ya está completo (cupo: %).', v_capacity;
  end if;

  return new;
end;
$$;

create trigger workshop_enrollments_check_capacity
  before insert or update of status on public.workshop_enrollments
  for each row execute function public.check_workshop_capacity();

create type public.attendance_status as enum ('present', 'absent', 'notified_absence');

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.workshop_enrollments (id) on delete cascade,
  session_date date not null,
  status public.attendance_status not null,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (enrollment_id, session_date)
);

create table public.workshop_dues (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.workshop_enrollments (id) on delete cascade,
  period text not null,
  amount numeric(12, 2) not null check (amount >= 0),
  due_date date,
  is_paid boolean not null default false,
  paid_at timestamptz,
  method_id uuid references public.payment_methods (id),
  notes text,
  created_at timestamptz not null default now(),
  unique (enrollment_id, period)
);

create index workshop_groups_program_id_idx on public.workshop_groups (program_id);
create index workshop_enrollments_group_id_idx on public.workshop_enrollments (group_id);
create index attendance_records_enrollment_id_idx on public.attendance_records (enrollment_id);
create index workshop_dues_enrollment_id_idx on public.workshop_dues (enrollment_id);

-- ============================================================================
-- Row Level Security
-- Groups/enrollments/attendance: workshop_staff can manage day-to-day.
-- Dues stay owner+operations only — money, not attendance (sección 52).
-- ============================================================================

alter table public.workshop_programs enable row level security;
alter table public.workshop_groups enable row level security;
alter table public.workshop_enrollments enable row level security;
alter table public.attendance_records enable row level security;
alter table public.workshop_dues enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'workshop_programs', 'workshop_groups', 'workshop_enrollments', 'attendance_records'
  ]
  loop
    execute format(
      'create policy "%1$s_select_authenticated" on public.%1$s for select to authenticated using (true);',
      t
    );
    execute format(
      'create policy "%1$s_write_workshop_staff" on public.%1$s for all to authenticated using (public.is_workshop_staff_or_above()) with check (public.is_workshop_staff_or_above());',
      t
    );
  end loop;
end $$;

create policy "workshop_dues_select_authenticated"
  on public.workshop_dues for select to authenticated using (true);
create policy "workshop_dues_write_operations"
  on public.workshop_dues for all to authenticated
  using (public.is_operations_or_owner()) with check (public.is_operations_or_owner());
