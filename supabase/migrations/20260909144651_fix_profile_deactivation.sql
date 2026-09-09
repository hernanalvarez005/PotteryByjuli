-- Fix — profiles.is_active was decorative, not enforced
-- Security audit finding: nothing ever read profiles.is_active to decide
-- whether a user could actually use the app, so deactivating a former
-- staff member's access did nothing — they could keep logging in freely.
-- On top of that, "profiles_update_self" (Fase 1) let a user update their
-- own row with no restriction on which columns, so they could flip their
-- own is_active back to true even if it HAD been enforced.
--
-- This adds the missing enforcement point: any authenticated request now
-- fails once the caller's own profile is inactive, and only an owner can
-- ever change is_active (self-updates to any other column still work).

create or replace function public.is_current_user_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_active from public.profiles where id = auth.uid()), false);
$$;

-- Blocks a non-owner from changing their own (or anyone else's) is_active,
-- even though profiles_update_self otherwise lets them update their row.
create or replace function public.guard_profile_is_active_change()
returns trigger
language plpgsql
as $$
begin
  if new.is_active is distinct from old.is_active and not public.is_owner() then
    raise exception 'Sólo la administradora puede activar o desactivar un usuario.';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_is_active_change
  before update on public.profiles
  for each row execute function public.guard_profile_is_active_change();

-- Every table's "select to authenticated" / "write ... to authenticated"
-- policy so far only checked the role, never whether the account is still
-- active. Rather than touching every one of the ~35 existing policies,
-- fold the check into the same role helpers they already call — an
-- inactive user now fails every one of has_role()/is_owner()/
-- is_operations_or_owner()/is_workshop_staff_or_above() at once.
create or replace function public.has_role(check_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_current_user_active() and exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = check_role
  );
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- has_role() already folds in is_current_user_active() above — every
  -- other permission helper (is_operations_or_owner(),
  -- is_workshop_staff_or_above()) composes is_owner()/has_role(), so they
  -- all inherit the deactivation check without needing their own changes.
  select public.has_role('owner');
$$;

-- Still lets a deactivated user read/update their OWN profiles row (so the
-- app can show them a clear "your access was revoked" state instead of a
-- silent RLS-denied error everywhere) — but every *role-gated* policy
-- across the app is now closed to them via has_role()/is_owner() above.
