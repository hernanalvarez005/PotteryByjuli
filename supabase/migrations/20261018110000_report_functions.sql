-- Reportes: definiciones oficiales y agregación en el servidor.
--
-- Hasta ahora los reportes traían FILAS (orders, payments, order_items) y las sumaban en JavaScript:
-- con más de 1.000 filas en el período PostgREST las corta en silencio y el total sale mal. Además
-- "ventas", "cobrado" y "pendiente" significaban cosas distintas según la pantalla. Esta migración
-- fija UNA definición de cada métrica y la calcula en Postgres:
--
--   Facturación  Σ orders.total de pedidos NO cancelados, por sale_date, con los filtros de unidad,
--                ubicación y canal de cierre. Incluye ventas rápidas.
--   Ticket       Facturación ÷ cantidad de pedidos (null si no hay).
--   Cobrado      Caja del período, por paid_at en hora Argentina: pagos de pedidos NO cancelados
--                + cuotas de taller + otros ingresos, con las reglas de inclusión de siempre:
--                  · cuotas: sólo si la unidad es "todas" o incluye `classes`, y sin filtro de canal
--                    (no tienen canal); el filtro de ubicación usa la del grupo;
--                  · otros ingresos: sólo con unidad "todas" y sin canal (no tienen ninguno).
--   Pendiente    Saldo VIGENTE (order_balances.balance) de los pedidos facturados en el período
--                ("cohorte"). Identidad: facturación = cobrado_cohorte − sobrepago + pendiente.
--                Además `pending_total_all` = saldo de TODOS los pedidos (mismo número que el KPI de
--                /pedidos, get_orders_receivable cuando no hay filtros).
--   Talleres     Se informan aparte (collected_workshops): nunca se suman a la facturación.
--
-- Todas las funciones son SECURITY INVOKER (la RLS de lectura de orders/payments/… sigue aplicando),
-- con search_path fijo y EXECUTE sólo para `authenticated`.

-- 1) Alcance compartido ------------------------------------------------------------------
-- Pedidos "facturados" en el período (la ÚNICA definición de facturación).
create function public.report_orders_in_scope(
  p_from date,
  p_to date,
  p_business_unit_ids uuid[] default null,
  p_location_id uuid default null,
  p_channel_id uuid default null
)
returns table(
  order_id uuid,
  business_unit_id uuid,
  closing_channel_id uuid,
  operation_type text,
  sale_date date,
  total numeric
)
language sql
stable
set search_path = public, pg_temp
as $$
  select o.id, o.business_unit_id, o.closing_channel_id, o.operation_type, o.sale_date, o.total
    from public.orders o
   where o.status <> 'cancelled'
     and o.sale_date between p_from and p_to
     and (p_business_unit_ids is null or o.business_unit_id = any(p_business_unit_ids))
     and (p_location_id is null or o.location_id = p_location_id)
     and (p_channel_id is null or o.closing_channel_id = p_channel_id);
$$;

-- Plata cobrada en el período (la ÚNICA definición de cobrado), con su origen.
create function public.report_collections_in_scope(
  p_from date,
  p_to date,
  p_business_unit_ids uuid[] default null,
  p_location_id uuid default null,
  p_channel_id uuid default null
)
returns table(kind text, paid_at timestamptz, amount numeric)
language sql
stable
set search_path = public, pg_temp
as $$
  with bounds as (
    select (p_from::timestamp at time zone 'America/Argentina/Buenos_Aires') as t0,
           ((p_to + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires') as t1,
           (select bu.id from public.business_units bu where bu.code = 'classes') as classes_id
  )
  select 'order'::text, p.paid_at, p.amount
    from bounds b
    join public.payments p on p.paid_at >= b.t0 and p.paid_at < b.t1 and p.order_id is not null
    join public.orders o on o.id = p.order_id
   where o.status <> 'cancelled'
     and (p_business_unit_ids is null or o.business_unit_id = any(p_business_unit_ids))
     and (p_location_id is null or o.location_id = p_location_id)
     and (p_channel_id is null or o.closing_channel_id = p_channel_id)
  union all
  select 'workshop'::text, p.paid_at, p.amount
    from bounds b
    join public.payments p on p.paid_at >= b.t0 and p.paid_at < b.t1 and p.workshop_due_id is not null
    join public.workshop_dues d on d.id = p.workshop_due_id
    join public.workshop_enrollments e on e.id = d.enrollment_id
    join public.workshop_groups g on g.id = e.group_id
   where (p_business_unit_ids is null or b.classes_id = any(p_business_unit_ids))
     and p_channel_id is null
     and (p_location_id is null or g.location_id = p_location_id)
  union all
  select 'other'::text, ie.occurred_at, ie.amount
    from bounds b
    join public.income_entries ie on ie.occurred_at >= b.t0 and ie.occurred_at < b.t1
   where p_business_unit_ids is null
     and p_channel_id is null
     and (p_location_id is null or ie.location_id = p_location_id);
$$;

-- 2) KPIs ------------------------------------------------------------------------------------
create function public.report_kpis(
  p_from date,
  p_to date,
  p_business_unit_ids uuid[] default null,
  p_location_id uuid default null,
  p_channel_id uuid default null
)
returns table(
  invoiced numeric,
  orders_count bigint,
  avg_ticket numeric,
  collected_total numeric,
  collected_orders numeric,
  collected_workshops numeric,
  collected_other numeric,
  collected_on_cancelled numeric,
  cohort_paid numeric,
  cohort_pending numeric,
  cohort_overpaid numeric,
  pending_total_all numeric,
  pending_orders_all bigint
)
language sql
stable
set search_path = public, pg_temp
as $$
  with scope as (
    select * from public.report_orders_in_scope(p_from, p_to, p_business_unit_ids, p_location_id, p_channel_id)
  ),
  cohort as (
    select coalesce(sum(b.paid_total), 0) as paid,
           coalesce(sum(b.balance), 0) as pending,
           coalesce(sum(greatest(b.paid_total - b.total, 0)), 0) as overpaid
      from scope s join public.order_balances b on b.order_id = s.order_id
  ),
  coll as (
    select coalesce(sum(c.amount), 0) as total,
           coalesce(sum(c.amount) filter (where c.kind = 'order'), 0) as orders,
           coalesce(sum(c.amount) filter (where c.kind = 'workshop'), 0) as workshops,
           coalesce(sum(c.amount) filter (where c.kind = 'other'), 0) as other
      from public.report_collections_in_scope(p_from, p_to, p_business_unit_ids, p_location_id, p_channel_id) c
  ),
  cancelled as (
    -- Informativo: plata cobrada sobre pedidos cancelados (no entra en "cobrado").
    select coalesce(sum(p.amount), 0) as amount
      from public.payments p
      join public.orders o on o.id = p.order_id
     where o.status = 'cancelled'
       and p.paid_at >= (p_from::timestamp at time zone 'America/Argentina/Buenos_Aires')
       and p.paid_at < ((p_to + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
       and (p_business_unit_ids is null or o.business_unit_id = any(p_business_unit_ids))
       and (p_location_id is null or o.location_id = p_location_id)
       and (p_channel_id is null or o.closing_channel_id = p_channel_id)
  ),
  allpending as (
    -- Saldo de todos los pedidos (sin período): con filtros vacíos == get_orders_receivable(null).
    select coalesce(sum(b.balance), 0) as pending, count(*) as n
      from public.order_balances b
      join public.orders o on o.id = b.order_id
     where b.operation_type = 'order'
       and b.status <> 'cancelled'
       and b.balance > 0
       and (p_business_unit_ids is null or o.business_unit_id = any(p_business_unit_ids))
       and (p_location_id is null or o.location_id = p_location_id)
       and (p_channel_id is null or o.closing_channel_id = p_channel_id)
  )
  select
    coalesce((select sum(s.total) from scope s), 0),
    (select count(*) from scope),
    (select avg(s.total) from scope s),
    coll.total, coll.orders, coll.workshops, coll.other,
    cancelled.amount,
    cohort.paid, cohort.pending, cohort.overpaid,
    allpending.pending, allpending.n
  from coll, cohort, cancelled, allpending;
$$;

-- 3) Serie en el tiempo ----------------------------------------------------------------------
-- Diaria si el rango es ≤ 62 días, mensual si es más largo. Los buckets sin datos vienen en 0
-- (el gráfico no "salta" días). Σ invoiced == report_kpis.invoiced y Σ collected == collected_total.
create function public.report_time_series(
  p_from date,
  p_to date,
  p_business_unit_ids uuid[] default null,
  p_location_id uuid default null,
  p_channel_id uuid default null
)
returns table(bucket text, invoiced numeric, orders_count bigint, collected numeric)
language sql
stable
set search_path = public, pg_temp
as $$
  with cfg as (
    select (p_to - p_from + 1) > 62 as monthly
  ),
  buckets as (
    select case when cfg.monthly then to_char(g, 'YYYY-MM') else to_char(g, 'YYYY-MM-DD') end as bucket
      from cfg,
           generate_series(
             case when cfg.monthly then date_trunc('month', p_from::timestamp) else p_from::timestamp end,
             p_to::timestamp,
             case when cfg.monthly then interval '1 month' else interval '1 day' end
           ) g
  ),
  inv as (
    select case when cfg.monthly then to_char(s.sale_date, 'YYYY-MM') else to_char(s.sale_date, 'YYYY-MM-DD') end as bucket,
           sum(s.total) as invoiced, count(*) as orders_count
      from cfg, public.report_orders_in_scope(p_from, p_to, p_business_unit_ids, p_location_id, p_channel_id) s
     group by 1
  ),
  col as (
    select case when cfg.monthly then to_char((c.paid_at at time zone 'America/Argentina/Buenos_Aires')::date, 'YYYY-MM')
                else to_char((c.paid_at at time zone 'America/Argentina/Buenos_Aires')::date, 'YYYY-MM-DD') end as bucket,
           sum(c.amount) as collected
      from cfg, public.report_collections_in_scope(p_from, p_to, p_business_unit_ids, p_location_id, p_channel_id) c
     group by 1
  )
  select b.bucket, coalesce(inv.invoiced, 0), coalesce(inv.orders_count, 0), coalesce(col.collected, 0)
    from buckets b
    left join inv on inv.bucket = b.bucket
    left join col on col.bucket = b.bucket
   order by b.bucket;
$$;

-- 4) Por unidad y por canal ------------------------------------------------------------------
-- Sólo pedidos (devengado). Talleres NO se mezcla acá: se informa aparte en report_kpis.
create function public.report_by_business_unit(
  p_from date,
  p_to date,
  p_business_unit_ids uuid[] default null,
  p_location_id uuid default null,
  p_channel_id uuid default null
)
returns table(business_unit_id uuid, name text, invoiced numeric, orders_count bigint)
language sql
stable
set search_path = public, pg_temp
as $$
  select s.business_unit_id, coalesce(bu.name, 'Sin unidad'), sum(s.total), count(*)
    from public.report_orders_in_scope(p_from, p_to, p_business_unit_ids, p_location_id, p_channel_id) s
    left join public.business_units bu on bu.id = s.business_unit_id
   group by s.business_unit_id, bu.name
   order by sum(s.total) desc, 2;
$$;

create function public.report_by_channel(
  p_from date,
  p_to date,
  p_business_unit_ids uuid[] default null,
  p_location_id uuid default null,
  p_channel_id uuid default null
)
returns table(channel_id uuid, name text, invoiced numeric, orders_count bigint)
language sql
stable
set search_path = public, pg_temp
as $$
  select s.closing_channel_id, coalesce(sc.name, 'Sin canal'), sum(s.total), count(*)
    from public.report_orders_in_scope(p_from, p_to, p_business_unit_ids, p_location_id, p_channel_id) s
    left join public.sales_channels sc on sc.id = s.closing_channel_id
   group by s.closing_channel_id, sc.name
   order by sum(s.total) desc, 2;
$$;

-- 5) Productos ---------------------------------------------------------------------------------
-- Unidades y facturación por ítem (cantidad × precio, ANTES del descuento global del pedido). Los
-- ítems a medida (sin variante) van agrupados en una fila "Ítems a medida" para que la suma por
-- producto cierre con la facturación.
create function public.report_top_products(
  p_from date,
  p_to date,
  p_business_unit_ids uuid[] default null,
  p_location_id uuid default null,
  p_channel_id uuid default null,
  p_limit integer default 10
)
returns table(variant_id uuid, product_id uuid, label text, units numeric, revenue numeric, is_custom boolean)
language sql
stable
set search_path = public, pg_temp
as $$
  select v.id,
         pr.id,
         case when v.id is null then 'Ítems a medida'
              when v.name = 'Único' then pr.name
              else pr.name || ' — ' || v.name end as label,
         sum(oi.quantity)::numeric,
         sum(oi.quantity * oi.unit_price),
         v.id is null
    from public.report_orders_in_scope(p_from, p_to, p_business_unit_ids, p_location_id, p_channel_id) s
    join public.order_items oi on oi.order_id = s.order_id
    left join public.product_variants v on v.id = oi.product_variant_id
    left join public.products pr on pr.id = v.product_id
   group by v.id, v.name, pr.id, pr.name
   order by sum(oi.quantity) desc, 3
   limit greatest(p_limit, 1);
$$;

-- Selección libre de modelos: "¿cuántas unidades vendí de estos modelos?". Recibe productos (todas
-- sus variantes) y/o variantes sueltas, y devuelve UNA fila por variante elegida, también las que no
-- vendieron nada (0), para que el grupo muestre todos los modelos. Mismo alcance que la facturación.
create function public.report_units_sold_selection(
  p_from date,
  p_to date,
  p_business_unit_ids uuid[] default null,
  p_location_id uuid default null,
  p_channel_id uuid default null,
  p_product_ids uuid[] default null,
  p_variant_ids uuid[] default null
)
returns table(variant_id uuid, product_id uuid, product_name text, variant_name text, label text, units numeric, revenue numeric)
language sql
stable
set search_path = public, pg_temp
as $$
  with chosen as (
    select v.id as variant_id, pr.id as product_id, pr.name as product_name, v.name as variant_name
      from public.product_variants v
      join public.products pr on pr.id = v.product_id
     where v.id = any(coalesce(p_variant_ids, '{}'::uuid[]))
        or pr.id = any(coalesce(p_product_ids, '{}'::uuid[]))
  ),
  sold as (
    select oi.product_variant_id as variant_id, sum(oi.quantity)::numeric as units, sum(oi.quantity * oi.unit_price) as revenue
      from public.report_orders_in_scope(p_from, p_to, p_business_unit_ids, p_location_id, p_channel_id) s
      join public.order_items oi on oi.order_id = s.order_id
     where oi.product_variant_id in (select c.variant_id from chosen c)
     group by oi.product_variant_id
  )
  select c.variant_id, c.product_id, c.product_name, c.variant_name,
         case when c.variant_name = 'Único' then c.product_name else c.product_name || ' — ' || c.variant_name end,
         coalesce(sd.units, 0), coalesce(sd.revenue, 0)
    from chosen c
    left join sold sd on sd.variant_id = c.variant_id
   order by coalesce(sd.units, 0) desc, 5;
$$;

-- 6) Conteos de /reportes (también se traían como filas, con el mismo tope) -------------------
create function public.report_production_counts()
returns table(status text, orders_count bigint)
language sql
stable
set search_path = public, pg_temp
as $$
  select po.status::text, count(*) from public.production_orders po group by po.status order by po.status::text;
$$;

create function public.report_wholesale_conversion()
returns table(total bigint, confirmed bigint)
language sql
stable
set search_path = public, pg_temp
as $$
  select count(*), count(*) filter (where o.status not in ('pending', 'cancelled'))
    from public.orders o
    join public.business_units bu on bu.id = o.business_unit_id
   where bu.code = 'wholesale';
$$;

-- 7) ACL explícita ---------------------------------------------------------------------------
revoke all on function public.report_orders_in_scope(date, date, uuid[], uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.report_collections_in_scope(date, date, uuid[], uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.report_kpis(date, date, uuid[], uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.report_time_series(date, date, uuid[], uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.report_by_business_unit(date, date, uuid[], uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.report_by_channel(date, date, uuid[], uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.report_top_products(date, date, uuid[], uuid, uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.report_units_sold_selection(date, date, uuid[], uuid, uuid, uuid[], uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.report_production_counts() from public, anon, authenticated, service_role;
revoke all on function public.report_wholesale_conversion() from public, anon, authenticated, service_role;

grant execute on function public.report_orders_in_scope(date, date, uuid[], uuid, uuid) to authenticated;
grant execute on function public.report_collections_in_scope(date, date, uuid[], uuid, uuid) to authenticated;
grant execute on function public.report_kpis(date, date, uuid[], uuid, uuid) to authenticated;
grant execute on function public.report_time_series(date, date, uuid[], uuid, uuid) to authenticated;
grant execute on function public.report_by_business_unit(date, date, uuid[], uuid, uuid) to authenticated;
grant execute on function public.report_by_channel(date, date, uuid[], uuid, uuid) to authenticated;
grant execute on function public.report_top_products(date, date, uuid[], uuid, uuid, integer) to authenticated;
grant execute on function public.report_units_sold_selection(date, date, uuid[], uuid, uuid, uuid[], uuid[]) to authenticated;
grant execute on function public.report_production_counts() to authenticated;
grant execute on function public.report_wholesale_conversion() to authenticated;
