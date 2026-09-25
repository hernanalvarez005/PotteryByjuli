-- Máximo UN PDF mayorista por pedido.
--
-- Hasta hoy nada impedía que un reintento (mismo client_request_id) o una
-- regeneración creara una segunda fila order_attachments con
-- kind = 'wholesale_request_pdf' para el mismo pedido (se vio en pruebas
-- locales). El backoffice sólo lee la más reciente, así que no rompía
-- nada visible, pero dejaba filas duplicadas.
--
-- Índice ÚNICO PARCIAL en vez de UNIQUE (order_id, kind): order_attachments
-- es una tabla genérica (kind es text nullable, sin CHECK) y otros tipos de
-- adjunto podrían repetirse legítimamente por pedido (fotos de referencia,
-- etc.). La restricción sólo aplica al PDF mayorista. `order_summary_pdf`
-- ya se reemplaza borrando y reinsertando, así que no la necesita.
--
-- Compatible con el código desplegado antes de esta migración: la
-- regeneración y el checkout ya actualizan la fila existente en vez de
-- insertar otra (lib/wholesale-pdf-store.ts), así que funcionan igual con o
-- sin el índice.
--
-- NUNCA borra ni fusiona datos: si ya hubiera duplicados, aborta con la
-- lista para resolverlos a mano antes de reintentar.

do $$
declare
  v_dupes text;
begin
  select string_agg(order_id::text || ' (' || n || ' filas)', ', ')
    into v_dupes
    from (
      select order_id, count(*) as n
        from public.order_attachments
       where kind = 'wholesale_request_pdf'
       group by order_id
      having count(*) > 1
    ) d;

  if v_dupes is not null then
    raise exception
      'Hay pedidos con más de un adjunto wholesale_request_pdf; resolvelos a mano antes de aplicar este índice: %', v_dupes;
  end if;
end $$;

create unique index order_attachments_one_wholesale_pdf_per_order
  on public.order_attachments (order_id)
  where kind = 'wholesale_request_pdf';
