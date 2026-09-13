-- Otros ingresos (Bloque 6 — "Próxima evolución operativa"). El único
-- dominio genuinamente nuevo de todo el pedido: hoy no hay nada parecido
-- a un ingreso sin producto (ej. Juli subalquilando un rincón del taller
-- a otra artesana). Reusa payment_methods/payment_accounts/locations —
-- nunca duplica esos catálogos. Deliberadamente NO referencia
-- products/product_variants: por diseño no puede alimentar unidades
-- vendidas ni stock, ni tampoco business_units (no pertenece a ninguna
-- unidad de negocio del catálogo).

create table public.income_entries (
  id uuid primary key default gen_random_uuid(),
  concept text not null,
  category text,                      -- catálogo simple, no un FK obligatorio para el MVP
  amount numeric(12, 2) not null check (amount > 0),
  occurred_at timestamptz not null,   -- fecha real del ingreso — mismo contrato que payments.paid_at
  method_id uuid references public.payment_methods (id),
  account_id uuid references public.payment_accounts (id),
  location_id uuid references public.locations (id),
  counterparty text,                  -- persona/emprendedora, opcional
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index income_entries_occurred_at_idx on public.income_entries (occurred_at);

-- Mismo nivel de sensibilidad que expenses/campaigns (Fase 9): datos
-- financieros, lectura y escritura sólo para dueña + operaciones —
-- nunca "cualquier autenticado" como los catálogos de producto.
alter table public.income_entries enable row level security;

create policy "income_entries_select_operations"
  on public.income_entries for select to authenticated using (public.is_operations_or_owner());
create policy "income_entries_write_operations"
  on public.income_entries for all to authenticated
  using (public.is_operations_or_owner()) with check (public.is_operations_or_owner());
