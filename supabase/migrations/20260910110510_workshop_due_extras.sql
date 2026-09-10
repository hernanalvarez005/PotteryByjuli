-- Extras de cuotas de talleres — sección 6 de la tanda de mejoras
-- operativas. Un cargo puntual como "Arcilla $8.500" se agrega ARRIBA de
-- la cuota mensual: nunca se inserta como payment (eso restaría del
-- saldo en vez de sumarlo) — son líneas aparte que aumentan lo que se
-- debe. Ver docs/business-rules.md § Cuotas mensuales de talleres.

-- ============================================================================
-- 1. Catálogo chico de conceptos — mismo patrón que payment_methods/
-- sales_channels (Fase 1): code, name, sort_order, is_active. Se
-- gestiona desde /configuracion vía CATALOG_TABLES (lib/catalog.ts), sin
-- componente nuevo.
-- ============================================================================

create table public.workshop_due_concepts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_workshop_due_concepts_updated_at
  before update on public.workshop_due_concepts
  for each row execute function public.set_updated_at();

alter table public.workshop_due_concepts enable row level security;

create policy "workshop_due_concepts_select_authenticated"
  on public.workshop_due_concepts for select to authenticated using (true);
create policy "workshop_due_concepts_write_owner"
  on public.workshop_due_concepts for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- ============================================================================
-- 2. Cargos por cuota — append-only a propósito. "Borrar" un extra es
-- anularlo (voided_at/voided_by), nunca un hard delete: como los pagos se
-- registran contra el TOTAL de una cuota y no contra un cargo puntual, no
-- hay forma de saber desde los datos si un pago histórico "correspondía"
-- a un extra específico, así que no existe una política condicional de
-- "si no tiene pagos asociados, borrar directo" — siempre se anula, un
-- solo camino de código.
--
-- Deliberadamente sin policy de update/delete para authenticated (ni
-- siquiera para owner/operations): la única forma de tocar una fila
-- después de insertada es la RPC void_due_item de abajo, que corre
-- `security definer` (igual que mark_wholesale_whatsapp_share_opened en
-- la fase mayorista) y sólo puede tocar voided_at/voided_by — nunca el
-- amount ni el concept_id de un cargo ya cargado. Esto es una garantía a
-- nivel de base de datos, no sólo disciplina de la UI: ni siquiera un
-- bug futuro que arme un `.update()` directo desde el cliente podría
-- mutar un cargo existente, porque RLS no lo permite.
-- ============================================================================

create table public.workshop_due_items (
  id uuid primary key default gen_random_uuid(),
  due_id uuid not null references public.workshop_dues (id) on delete cascade,
  concept_id uuid not null references public.workshop_due_concepts (id),
  amount numeric(12, 2) not null check (amount > 0),
  note text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id)
);

create index workshop_due_items_due_id_idx on public.workshop_due_items (due_id);

alter table public.workshop_due_items enable row level security;

create policy "workshop_due_items_select_authenticated"
  on public.workshop_due_items for select to authenticated using (true);
create policy "workshop_due_items_insert_operations"
  on public.workshop_due_items for insert to authenticated
  with check (public.is_operations_or_owner());

create or replace function public.void_due_item(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_operations_or_owner() then
    raise exception 'No tenés permiso para anular cargos.';
  end if;
  update public.workshop_due_items
  set voided_at = now(), voided_by = auth.uid()
  where id = p_id and voided_at is null;
end;
$$;

grant execute on function public.void_due_item(uuid) to authenticated;
