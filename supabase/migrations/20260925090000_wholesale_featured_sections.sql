-- Secciones destacadas del catálogo mayorista (merchandising editorial).
--
-- Una categoría describe qué ES un producto; una sección destacada
-- describe qué queremos PROMOCIONAR ahora ("Día de la Madre", "Novedades").
-- Sólo guarda REFERENCIAS a productos: nunca duplica productos, ni toca
-- categorías, precios, stock, variantes o historial.
--
-- Regla obligatoria: una sección nunca hace reaparecer un producto que no
-- es visible en /mayorista. La visibilidad del producto la decide
-- products.is_active + wholesale_product_rules.is_public (+ variante
-- activa + precio mayorista); acá NO se replica ni se duplica: la app
-- resuelve los productos destacados contra el catálogo ya visible, y el
-- RLS de `anon` exige además is_active + is_public.
--
-- Aditiva: sin backfill, sin tocar ninguna tabla existente. Si no hay
-- secciones, /mayorista queda exactamente igual que hoy.

create table public.wholesale_featured_sections (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  -- Ancla estable para la URL/DOM; la deriva la app del título.
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text check (description is null or char_length(description) <= 500),
  -- Override manual: false = desactivada/archivada, sin importar las fechas.
  is_active boolean not null default true,
  -- Ventana opcional (nunca obligatoria). Se evalúa con now() en cada
  -- request, así que la sección se activa/desactiva sola, sin cron.
  starts_at timestamptz,
  ends_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wholesale_featured_sections_dates_ordered
    check (starts_at is null or ends_at is null or starts_at <= ends_at)
);

create index wholesale_featured_sections_sort_order_idx
  on public.wholesale_featured_sections (sort_order);

create trigger set_wholesale_featured_sections_updated_at
  before update on public.wholesale_featured_sections
  for each row execute function public.set_updated_at();

create table public.wholesale_featured_section_products (
  section_id uuid not null references public.wholesale_featured_sections (id) on delete cascade,
  -- Borrar una sección o un producto sólo borra la asociación, nunca al
  -- otro lado (un producto con historial igual no se puede borrar: ver
  -- delete_product_safe).
  product_id uuid not null references public.products (id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (section_id, product_id)
);

create index wholesale_featured_section_products_product_idx
  on public.wholesale_featured_section_products (product_id);

-- ============================================================================
-- RLS
-- ============================================================================

alter table public.wholesale_featured_sections enable row level security;
alter table public.wholesale_featured_section_products enable row level security;

-- Backoffice: lectura completa (incluye inactivas/programadas/vencidas).
create policy "wholesale_featured_sections_select_authenticated"
  on public.wholesale_featured_sections for select to authenticated using (true);
create policy "wholesale_featured_section_products_select_authenticated"
  on public.wholesale_featured_section_products for select to authenticated using (true);

-- Sólo owner escribe (mismo criterio que wholesale_product_rules y
-- wholesale_settings) — no se amplía a operations.
create policy "wholesale_featured_sections_write_owner"
  on public.wholesale_featured_sections for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
create policy "wholesale_featured_section_products_write_owner"
  on public.wholesale_featured_section_products for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- Público: sólo secciones activas y vigentes...
create policy "wholesale_featured_sections_select_anon"
  on public.wholesale_featured_sections for select to anon
  using (
    is_active
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at >= now())
  );

-- ...y sólo sus relaciones con productos que hoy son públicos. RLS se
-- evalúa también dentro de las policies: products y
-- wholesale_product_rules ya tienen policy de `anon`, y la sección
-- vigente se resuelve con la policy de arriba.
create policy "wholesale_featured_section_products_select_anon"
  on public.wholesale_featured_section_products for select to anon
  using (
    exists (
      select 1 from public.wholesale_featured_sections s
      where s.id = wholesale_featured_section_products.section_id
        and s.is_active
        and (s.starts_at is null or s.starts_at <= now())
        and (s.ends_at is null or s.ends_at >= now())
    )
    and exists (
      select 1 from public.products p
      join public.wholesale_product_rules wpr on wpr.product_id = p.id
      where p.id = wholesale_featured_section_products.product_id
        and p.is_active and wpr.is_public
    )
  );

-- ============================================================================
-- RPCs (security invoker: el RLS de escritura de arriba sigue aplicando;
-- el chequeo explícito de owner sólo da un error claro en vez de un
-- "0 filas afectadas" silencioso).
-- ============================================================================

-- Crea o edita una sección Y reemplaza su lista ordenada de productos en
-- una única transacción — nunca queda una sección creada con productos a
-- medio guardar. El orden de los productos es el del array. En una edición
-- el slug no cambia (es un ancla estable); en una alta la nueva sección
-- queda al final del orden de secciones.
create or replace function public.save_wholesale_featured_section(
  p_id uuid,
  p_title text,
  p_slug text,
  p_description text,
  p_is_active boolean,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_product_ids uuid[]
)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_id uuid;
begin
  if not public.is_owner() then
    raise exception 'Sólo la administradora puede modificar las secciones destacadas.';
  end if;

  if p_id is null then
    insert into public.wholesale_featured_sections
      (title, slug, description, is_active, starts_at, ends_at, sort_order)
    values (
      p_title, p_slug, nullif(btrim(p_description), ''), coalesce(p_is_active, true), p_starts_at, p_ends_at,
      coalesce((select max(sort_order) + 1 from public.wholesale_featured_sections), 0)
    )
    returning id into v_id;
  else
    update public.wholesale_featured_sections
       set title = p_title,
           description = nullif(btrim(p_description), ''),
           is_active = coalesce(p_is_active, true),
           starts_at = p_starts_at,
           ends_at = p_ends_at
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'La sección no existe.';
    end if;
  end if;

  -- Reemplazo atómico, sin duplicados, en el orden del array.
  delete from public.wholesale_featured_section_products where section_id = v_id;
  insert into public.wholesale_featured_section_products (section_id, product_id, sort_order)
  select v_id, t.product_id, min(t.ord)::integer - 1
  from unnest(coalesce(p_product_ids, '{}'::uuid[])) with ordinality as t(product_id, ord)
  group by t.product_id;

  return v_id;
end;
$$;

-- Reordena las secciones: el orden del array pasa a ser su sort_order.
create or replace function public.reorder_wholesale_featured_sections(p_section_ids uuid[])
returns void
language plpgsql
security invoker
as $$
begin
  if not public.is_owner() then
    raise exception 'Sólo la administradora puede modificar las secciones destacadas.';
  end if;

  update public.wholesale_featured_sections s
     set sort_order = t.ord::integer - 1
    from unnest(p_section_ids) with ordinality as t(id, ord)
   where s.id = t.id;
end;
$$;

grant execute on function public.save_wholesale_featured_section to authenticated;
grant execute on function public.reorder_wholesale_featured_sections to authenticated;
