-- Fecha real de venta/entrega (auditoría "Próxima evolución operativa",
-- bloque 1, corregido) — orders.created_at es cuándo se cargó al
-- sistema, nunca cuándo el pedido se reconoció como vendido/entregado.
-- Esa fecha real ya existe de forma confiable en order_status_history
-- (poblada, sin excepción, por los triggers de esa tabla desde la
-- primera migración) — acá sólo se denormaliza a una columna propia de
-- orders para que los reportes no tengan que hacer join en cada query.
--
-- A propósito un trigger BEFORE, separado e independiente de los
-- triggers AFTER que alimentan order_status_history: un trigger AFTER
-- ya no puede mutar la fila que acaba de escribirse (el insert/update ya
-- se hizo), así que la única forma de que sold_at se complete solo es
-- interceptando la fila ANTES de que se guarde.

alter table public.orders add column sold_at timestamptz;

create or replace function public.set_order_sold_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'delivered' and new.sold_at is null then
    new.sold_at := now();
  end if;
  return new;
end;
$$;

create trigger orders_set_sold_at
  before insert or update of status on public.orders
  for each row execute function public.set_order_sold_at();
