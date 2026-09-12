-- Cupos de grupo editables, nunca por debajo de las alumnas activas
-- inscriptas (tanda de usabilidad, sección 18). El Server Action ya
-- valida esto para dar el mensaje amigable exacto que pide el pedido
-- ("Hay 7 alumnas inscriptas. La capacidad no puede reducirse a 6.") —
-- este trigger es la misma defensa de fondo que el resto del dominio ya
-- usa (recalculate_order_totals, etc.): nunca confiar sólo en la capa de
-- aplicación para un invariante de negocio.

create or replace function public.check_workshop_group_capacity()
returns trigger
language plpgsql
as $$
declare
  v_active_count integer;
begin
  if new.capacity < old.capacity then
    select count(*) into v_active_count
    from public.workshop_enrollments
    where group_id = new.id and status = 'active';

    if new.capacity < v_active_count then
      raise exception 'Hay % alumnas inscriptas. La capacidad no puede reducirse a %.', v_active_count, new.capacity;
    end if;
  end if;
  return new;
end;
$$;

create trigger workshop_groups_check_capacity
  before update of capacity on public.workshop_groups
  for each row execute function public.check_workshop_group_capacity();
