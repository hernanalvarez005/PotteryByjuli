-- Fusionar clientes duplicados (tanda de usabilidad, secciones 20-22) —
-- el principal sobrevive, el duplicado se archiva (nunca hard delete,
-- se pierde trazabilidad) con un puntero explícito a dónde quedó. Todas
-- las FK del duplicado se migran al principal CUANDO ES SEGURO — donde
-- hay una restricción de unicidad real (workshop_enrollments,
-- customer_tag_links) que impediría migrar sin perder una fila, esa fila
-- puntual se deja tal cual, apuntando al duplicado archivado (que sigue
-- existiendo, así que la historia nunca se rompe).

alter table public.customers
  add column merged_into_customer_id uuid references public.customers (id),
  add column merged_at timestamptz,
  add column merged_by uuid references public.profiles (id);

create index customers_merged_into_customer_id_idx on public.customers (merged_into_customer_id);

create or replace function public.merge_customers(
  p_primary_id uuid,
  p_duplicate_id uuid,
  -- Valores ya resueltos por la usuaria cuando principal y duplicado
  -- difieren (sección 22) — null significa "no tocar el valor actual
  -- del principal", nunca "borrarlo".
  p_whatsapp text default null,
  p_email text default null,
  p_cuit text default null,
  p_company_name text default null
)
returns void
language plpgsql
security invoker
as $$
begin
  if not public.is_owner() then
    raise exception 'Sólo la administradora puede fusionar clientes.';
  end if;

  if p_primary_id = p_duplicate_id then
    raise exception 'Elegí dos clientes distintos.';
  end if;

  if not exists (select 1 from public.customers where id = p_primary_id) then
    raise exception 'El cliente principal no existe.';
  end if;
  if not exists (select 1 from public.customers where id = p_duplicate_id and merged_into_customer_id is null) then
    raise exception 'El cliente duplicado no existe o ya fue fusionado.';
  end if;

  -- FKs sin restricción de unicidad — migración directa, siempre segura.
  update public.orders set customer_id = p_primary_id where customer_id = p_duplicate_id;
  update public.event_registrations set customer_id = p_primary_id where customer_id = p_duplicate_id;
  update public.customer_notes set customer_id = p_primary_id where customer_id = p_duplicate_id;

  -- workshop_enrollments tiene unique(group_id, customer_id) — sólo se
  -- migra la inscripción del duplicado a un grupo donde el principal
  -- todavía no está inscripto. Si ya está en ese mismo grupo, se deja la
  -- del duplicado como está (su historial de cuotas sigue intacto,
  -- resuelto a través del duplicado archivado).
  update public.workshop_enrollments we
  set customer_id = p_primary_id
  where we.customer_id = p_duplicate_id
    and not exists (
      select 1 from public.workshop_enrollments we2
      where we2.group_id = we.group_id and we2.customer_id = p_primary_id
    );

  -- customer_tag_links tiene PK compuesta (customer_id, tag_id) — se
  -- unen los tags de ambos en el principal (nunca se pierde una
  -- clasificación), y se limpia el duplicado (no es historial, es
  -- configuración actual).
  insert into public.customer_tag_links (customer_id, tag_id)
  select p_primary_id, tag_id from public.customer_tag_links where customer_id = p_duplicate_id
  on conflict (customer_id, tag_id) do nothing;
  delete from public.customer_tag_links where customer_id = p_duplicate_id;

  -- Conflictos de datos resueltos explícitamente por la usuaria — nunca
  -- decidido en silencio acá. Un valor null en el parámetro no toca el
  -- campo del principal.
  update public.customers
  set
    whatsapp = coalesce(p_whatsapp, whatsapp),
    email = coalesce(p_email, email),
    cuit = coalesce(p_cuit, cuit),
    company_name = coalesce(p_company_name, company_name)
  where id = p_primary_id;

  -- El duplicado nunca se borra — se archiva (mismo mecanismo ya
  -- existente de is_active=false) y queda apuntando a dónde se fusionó.
  update public.customers
  set
    is_active = false,
    merged_into_customer_id = p_primary_id,
    merged_at = now(),
    merged_by = auth.uid()
  where id = p_duplicate_id;
end;
$$;

grant execute on function public.merge_customers to authenticated;
