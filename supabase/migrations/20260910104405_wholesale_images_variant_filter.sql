-- Sección 5 de la tanda de mejoras operativas (imágenes ↔ variantes): hoy
-- product_images_select_public_wholesale (Fase 5) sólo exige que el
-- producto esté activo y sea público — nunca mira product_images.variant_id.
-- Una imagen atada a una variante que después se desactiva sigue siendo
-- visible para anon en /mayorista, aunque esa variante ya no aparezca en
-- el selector. Este cambio sólo achica acceso (nunca lo amplía): una
-- imagen general (variant_id is null) sigue visible igual que antes; una
-- imagen atada a una variante ahora exige que esa variante también esté
-- activa. Ver docs/business-rules.md § Seguridad del portal mayorista
-- público y el test de regresión en
-- lib/wholesale-image-variant-filter.integration.test.ts (confirma que
-- todo lo que era visible antes lo sigue siendo, y que sólo el caso nuevo
-- queda oculto).

drop policy "product_images_select_public_wholesale" on public.product_images;

create policy "product_images_select_public_wholesale"
  on public.product_images for select to anon
  using (
    exists (
      select 1 from public.products p
      join public.wholesale_product_rules wpr on wpr.product_id = p.id
      where p.id = product_images.product_id and p.is_active and wpr.is_public
    )
    and (
      product_images.variant_id is null
      or exists (
        select 1 from public.product_variants pv
        where pv.id = product_images.variant_id and pv.is_active
      )
    )
  );
