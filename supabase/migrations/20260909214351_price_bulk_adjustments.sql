-- Audit trail for bulk price adjustments (Productos → ajuste masivo).
-- Nothing existing tracks "one operation affecting N rows" — order_status_
-- history and similar *_history tables log one row change each, not a
-- batch — so this is the one genuinely new table this feature needs.
-- price_list_items.updated_by/updated_at (Fase 2) already covers "who
-- changed this specific price last"; this covers "what was the bulk
-- operation that did it".

create table public.price_bulk_adjustments (
  id uuid primary key default gen_random_uuid(),
  price_list_id uuid references public.price_lists (id),
  adjustment_kind text not null check (adjustment_kind in ('percentage', 'fixed')),
  operation text not null check (operation in ('increase', 'decrease')),
  value numeric(12, 2) not null,
  affected_count integer not null,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

alter table public.price_bulk_adjustments enable row level security;

create policy "price_bulk_adjustments_select_authenticated"
  on public.price_bulk_adjustments for select to authenticated using (true);

create policy "price_bulk_adjustments_write_operations"
  on public.price_bulk_adjustments for insert to authenticated
  with check (public.is_operations_or_owner());
