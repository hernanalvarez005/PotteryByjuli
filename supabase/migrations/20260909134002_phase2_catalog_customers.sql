-- Phase 2 — Catalog & Customers
-- Single source of truth for products/variants/prices and for the
-- customer base shared by every business unit. See docs/database.md.

-- ============================================================================
-- Product catalog
-- ============================================================================

create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.product_categories (id) on delete set null,
  name text not null,
  description text,
  cost_estimate numeric(12, 2),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every product has at least one variant, even a "single" one — nothing in
-- the rest of the model (stock, prices, order items) ever points at a bare
-- product; it always points at a variant (docs/database.md § Fase 2).
create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  name text not null default 'Único',
  sku text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, name)
);

create unique index product_variants_sku_key
  on public.product_variants (sku)
  where sku is not null;

-- Guarantees the "every product has ≥1 variant" invariant at the DB level
-- — holds even for a future bulk import or admin script that only knows
-- about `products`, not the rest of the model.
create or replace function public.create_default_product_variant()
returns trigger
language plpgsql
as $$
begin
  insert into public.product_variants (product_id, name)
  values (new.id, 'Único');
  return new;
end;
$$;

create trigger products_create_default_variant
  after insert on public.products
  for each row execute function public.create_default_product_variant();

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  variant_id uuid references public.product_variants (id) on delete cascade,
  storage_path text not null,
  is_primary boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- Prices
-- Never store a price directly on a product/variant — always through a
-- price list, so "minorista" and "mayorista" (and future lists: promo,
-- revendedor) are just more rows, not more columns.
-- ============================================================================

create table public.price_lists (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.price_list_items (
  id uuid primary key default gen_random_uuid(),
  price_list_id uuid not null references public.price_lists (id) on delete cascade,
  product_variant_id uuid not null references public.product_variants (id) on delete cascade,
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  unique (price_list_id, product_variant_id)
);

-- ============================================================================
-- Customers — single base shared by every business unit (retail, wholesale,
-- students, workshops...). Segments are tags, never separate tables.
-- ============================================================================

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text,
  whatsapp text,
  email text,
  dni text,
  cuit text,
  company_name text,
  instagram text,
  website text,
  city text,
  province text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customer_tags (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customer_tag_links (
  customer_id uuid not null references public.customers (id) on delete cascade,
  tag_id uuid not null references public.customer_tags (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (customer_id, tag_id)
);

create table public.customer_notes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  author_id uuid references public.profiles (id),
  note text not null,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- updated_at triggers
-- ============================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'product_categories', 'products', 'product_variants',
    'price_lists', 'customers', 'customer_tags'
  ]
  loop
    execute format(
      'create trigger set_%1$s_updated_at before update on public.%1$s for each row execute function public.set_updated_at();',
      t
    );
  end loop;
end $$;

create trigger set_price_list_items_updated_at
  before update on public.price_list_items
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Row Level Security
-- Reads: any authenticated staff member (small team, no need to segment
-- reads further yet). Writes: owner + operations for products/customers;
-- owner-only for price lists/items (pricing is explicitly audit-sensitive
-- — see docs/business-rules.md) and for the customer_tags catalog itself
-- (same pattern as the Phase 1 configuration catalogs).
-- ============================================================================

alter table public.product_categories enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_images enable row level security;
alter table public.price_lists enable row level security;
alter table public.price_list_items enable row level security;
alter table public.customers enable row level security;
alter table public.customer_tags enable row level security;
alter table public.customer_tag_links enable row level security;
alter table public.customer_notes enable row level security;

create or replace function public.is_operations_or_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_owner() or public.has_role('operations');
$$;

do $$
declare
  t text;
begin
  -- Read for any authenticated user; write for owner + operations.
  foreach t in array array[
    'product_categories', 'products', 'product_variants', 'product_images',
    'customers', 'customer_tag_links', 'customer_notes'
  ]
  loop
    execute format(
      'create policy "%1$s_select_authenticated" on public.%1$s for select to authenticated using (true);',
      t
    );
    execute format(
      'create policy "%1$s_write_operations" on public.%1$s for all to authenticated using (public.is_operations_or_owner()) with check (public.is_operations_or_owner());',
      t
    );
  end loop;

  -- Read for any authenticated user; write for owner only.
  foreach t in array array['price_lists', 'price_list_items', 'customer_tags']
  loop
    execute format(
      'create policy "%1$s_select_authenticated" on public.%1$s for select to authenticated using (true);',
      t
    );
    execute format(
      'create policy "%1$s_write_owner" on public.%1$s for all to authenticated using (public.is_owner()) with check (public.is_owner());',
      t
    );
  end loop;
end $$;

-- ============================================================================
-- Storage: product images
-- Public bucket — product photos are meant to be shown on the (future)
-- public wholesale catalog. No customer files or order attachments live
-- here; those get their own private buckets in a later phase.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

create policy "product_images_public_read"
  on storage.objects for select
  using (bucket_id = 'product-images');

create policy "product_images_write_operations"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'product-images' and public.is_operations_or_owner())
  with check (bucket_id = 'product-images' and public.is_operations_or_owner());

-- ============================================================================
-- Seed
-- ============================================================================

insert into public.product_categories (code, name, sort_order) values
  ('tazas', 'Tazas', 1),
  ('mates', 'Mates', 2),
  ('vajilla', 'Vajilla', 3),
  ('macetas', 'Macetas', 4),
  ('decoracion', 'Decoración', 5),
  ('sets', 'Sets', 6)
on conflict (code) do nothing;

insert into public.price_lists (code, name) values
  ('retail', 'Minorista'),
  ('wholesale', 'Mayorista')
on conflict (code) do nothing;

insert into public.customer_tags (code, name, sort_order) values
  ('retail', 'Minorista', 1),
  ('wholesale', 'Mayorista', 2),
  ('student', 'Alumno/a', 3),
  ('workshop', 'Workshop', 4),
  ('recurring', 'Recurrente', 5),
  ('potential_wholesale', 'Potencial mayorista', 6),
  ('custom', 'Personalizado', 7),
  ('other', 'Otro', 8)
on conflict (code) do nothing;
