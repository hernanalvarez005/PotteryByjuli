-- Import identity — minimal support for a safe, idempotent bulk import
-- (Tienda Nube catalog export). Nothing here is import-specific business
-- logic; it's the smallest general-purpose primitive the domain was
-- missing: "this row came from an external system, and here's its id
-- there" (docs/business-rules.md § Importación de datos reales).

-- ============================================================================
-- 1. External identity on products. Variants don't need their own —
-- (product_id, name) is already unique (Fase 2), and Tienda Nube gives us
-- no per-variant SKU/barcode to key off anyway (0/174 rows had one in the
-- real export). One row per Tienda Nube "Identificador de URL" is exactly
-- what `products` already models; variants key off the existing
-- uniqueness instead of a parallel identity column.
-- ============================================================================

alter table public.products
  add column external_source text,
  add column external_id text;

-- Partial + composite: most products will never have this (manually
-- created in the backoffice), and a source's id space is only unique
-- within that source.
create unique index products_external_identity_key
  on public.products (external_source, external_id)
  where external_source is not null and external_id is not null;

-- ============================================================================
-- 2. A movement type for "we're declaring this stock exists" as opposed to
-- any real-world event (purchase/sale/production) — the one thing an
-- initial data load needs that the Fase 4 ledger didn't anticipate.
-- Added on its own here (not used until the import script runs later) so
-- it's never referenced in the same transaction it's created in.
-- ============================================================================

alter type public.inventory_movement_type add value 'initial_import';
