# Roadmap — Pottery

Fases en orden de prioridad (criterio: integridad de datos > operación
diaria > simplicidad para Juli > trazabilidad > experiencia del comprador
> reporting > estética). El link mayorista (Fase 5) es la prioridad de
negocio más alta apenas estén las fundaciones.

Estado real: ver el checkbox. La navegación del backoffice
(`lib/nav.ts`) usa el mismo número de fase para decidir qué enlaces están
activos vs. "Próximamente".

## Fase 0 — Auditoría y arquitectura ✅

Repo creado, Next.js + Supabase + Tailwind + shadcn/ui escafoldados,
`docs/*.md` iniciales. Sin proyecto Supabase real todavía (ver
`docs/architecture.md` § Riesgos).

## Fase 1 — Fundaciones ✅

- [x] Next.js App Router, Tailwind, shadcn/ui.
- [x] Clientes Supabase SSR (`lib/supabase/*`), `proxy.ts` con refresco de
      sesión y redirect a `/login`.
- [x] Roles (`app_role`, `user_roles`) + helpers `has_role`/`is_owner`.
- [x] Catálogos: `business_units`, `locations`, `sales_channels`,
      `payment_methods`, `payment_accounts`, `settings` — migration +
      seed + RLS.
- [x] Pantalla `/configuracion`: alta y activar/desactivar por catálogo,
      sólo `owner` escribe.
- [x] Layout de backoffice (sidebar + navegación completa, con fases
      futuras deshabilitadas) y `/dashboard` mínimo.
- [x] Proyecto Supabase real creado y linkeado (`mgpybpbkjosxzaptlwnm`),
      migration aplicada, primer usuario `owner` dado de alta y login
      verificado de punta a punta en local.

**Resultado**: se puede ingresar de forma segura. ✅ Verificado.

Nota de infraestructura: la conexión **directa** de Postgres
(`db.<ref>.supabase.co:5432`) no es alcanzable desde esta red (sólo tiene
registro IPv6 y la conexión residencial no lo enruta bien) — usar siempre
el **connection pooler** (`aws-0-sa-east-1.pooler.supabase.com:5432`,
usuario `postgres.<project-ref>`) para `supabase db push`/CLI desde esta
máquina.

## Fase 2 — Catálogo + Clientes ✅

- [x] `product_categories`, `products`, `product_variants` (con trigger
      que crea la variante por defecto), `product_images` + bucket
      público `product-images`.
- [x] `price_lists`/`price_list_items` (minorista/mayorista), edición
      sólo por `owner`.
- [x] `customers`, `customer_tags`, `customer_tag_links`,
      `customer_notes`.
- [x] `/productos`, `/productos/[id]` (variantes, precios, imágenes),
      `/precios` (vista tipo planilla), `/clientes`, `/clientes/[id]`
      (ficha con tags y notas).
- [x] Migration aplicada a producción vía SQL Editor (mismo motivo que en
      Fase 1) y verificada — las 10 tablas responden.

**Resultado**: una sola fuente de productos, precios y clientes. ✅

## Fase 3 — Pedidos + Pagos ✅

`orders`/`order_items` (código `PED-000123` automático, precio congelado
por ítem), estados con historial automático, `payments` separado del
pedido, `/pedidos`, `/pedidos/nuevo`, `/pedidos/[id]`, `/pagos`. Migration
verificada (6 tablas + función RPC `create_order`).
**Resultado**: Pottery puede operar ventas reales desde el sistema. ✅

## Fase 4 — Stock ✅

- [x] `inventory_items` (se crea solo por cada variante de producto, vía
      trigger — reposición, materias primas y packaging comparten la
      misma tabla mediante `item_type`).
- [x] `inventory_movements`: ledger append-only, sin política de
      UPDATE/DELETE — nadie puede reescribir un movimiento ya hecho.
- [x] `inventory_reservations`: disponible = físico − reservado.
- [x] `stock_thresholds`, `stock_transfers`/`stock_transfer_items` +
      función RPC `complete_stock_transfer` (atómica: sale+entra o nada).
- [x] **Integración con pedidos**: `set_order_status()` reserva stock al
      confirmar, lo consume al entregar, lo libera al cancelar — antes
      era un `update` directo (Fase 3), ahora pasa por esta función.
- [x] `/stock`: vista de físico/reservado/disponible + alerta por
      mínimo, ajustes con motivo obligatorio, transferencias entre
      ubicaciones.

**Resultado**: Juli conoce el stock real por ubicación y su trazabilidad. ✅

## Fase 5 — Mayoristas (prioridad de negocio más alta) ✅

- [x] `wholesale_settings` (condiciones globales) + `wholesale_product_rules`
      (público/mínimo/múltiplo/plazo por producto), editables desde
      `/configuracion` y cada ficha de producto — sólo `owner`.
- [x] `/mayorista`: catálogo público mobile-first (sin login — `/mayorista`
      ya estaba en la lista de rutas públicas de `proxy.ts` desde la Fase
      1), búsqueda, filtro por categoría, selector de variante, carrito
      persistido en `localStorage`.
- [x] Validación de mínimos en vivo en el carrito (monto, piezas totales,
      mínimo y múltiplo por producto) — igual a la que corre en el
      servidor, nunca deja enviar un pedido inválido.
- [x] `submit_wholesale_request()` (RPC, único punto de escritura para
      anónimos): recalcula cada precio del lado servidor, revalida
      mínimos, crea o reutiliza el cliente, y crea el pedido con snapshot
      de condiciones — nunca confía en lo que mande el navegador.
- [x] RLS pública: sólo productos activos y marcados públicos, sus
      variantes/imágenes/precio mayorista y las condiciones generales;
      cero acceso a clientes, otros pedidos, costos o reportes.
- [x] Código `MAY-000123` en vez de `PED-000123` para pedidos mayoristas
      (misma tabla, mismo secuencial).
- [x] `/mayoristas` (backoffice): lista de solicitudes, reutiliza
      `/pedidos/[id]` para el detalle — no hay una UI de pedido paralela.

**Resultado**: Juli deja de mandar catálogo + Excel. Manda **un link**. ✅

## Fase 6 — Producción ✅

- [x] `production_orders`/`production_stage_events` (historial de etapa
      automático, mismo patrón que `orders`), código `PRO-000123`.
- [x] `complete_production_order()` (RPC): ingresa exactamente lo
      producido a stock, registra la merma sin ocultarla.
- [x] **Conexión automática con pedidos**: `set_order_status()` (Fases
      4/6) ahora reserva sólo lo disponible al confirmar un pedido y
      genera la orden de producción por la diferencia — con su origen
      (minorista/mayorista/personalizado) — sin que nadie tenga que
      crearla a mano.
- [x] `/produccion`: tablero por etapa (modelado → secado → 1ª cocción →
      esmaltado → 2ª cocción → control → terminado), "Nueva orden" manual
      para reposición.

**Resultado**: Juli sabe qué hay que fabricar y por qué. ✅

## Fase 7 — Talleres ✅

- [x] `workshop_programs`/`workshop_groups`/`workshop_enrollments`
      (alumnos = `customers`, nunca una tabla aparte) con cupo
      verificado por trigger, no sólo en la UI.
- [x] `attendance_records` (presente/ausente/avisó, un clic por alumno)
      y `workshop_dues` (período/importe/vencimiento/pagada).
- [x] `/talleres`: programas + grupos con cupo en vivo. Detalle de
      grupo: inscribir, asistencia del día, estado de inscripción,
      cuotas (`owner`+`operations`).
- [x] Rol `workshop_staff` ya tiene permisos reales sobre esto desde la
      Fase 1 — puede gestionar grupos/alumnos/asistencia, no cuotas.

**Resultado**: Juli conoce alumnos, asistencia y deuda por grupo. ✅

## Fase 8 — Workshops + Ferias ✅

- [x] `events`/`event_registrations` (cupo verificado por trigger, código
      `WOR-`/`FER-`), `/eventos` + detalle con inscripción, pago y
      resultado (ingresos − costo estimado).
- [x] Las ferias **no** tienen un modelo de stock paralelo: una feria es
      una `locations` de tipo `fair` — enviar/devolver mercadería usa las
      transferencias de la Fase 4, y las ventas en la feria son `orders`
      normales en esa ubicación. `orders.event_id` y
      `stock_transfers.event_id` (columnas nuevas, nullable) permiten
      atribuir esas operaciones a la feria exacta.
- [ ] **Pendiente** (no bloqueante): la UI de "Nuevo pedido" y "Nueva
      transferencia" todavía no exponen un selector para tildar
      `event_id` — hoy se puede setear a mano vía SQL si hace falta
      armar el resultado de una feria ya cerrada. Sumar ese selector es
      un cambio chico cuando haga falta de verdad.

**Resultado**: Juli sabe si un workshop o una feria dio resultado. ✅ (con
la salvedad de arriba)

## Fase 9 — Finanzas + Reportes ✅

- [x] `expense_categories` (catálogo) + `expenses`, `campaigns` +
      `orders.campaign_id` (diferida desde la Fase 3). Primeras tablas
      con lectura restringida a `owner`+`operations` — `viewer` no ve
      finanzas, tal como dice el modelo de permisos.
- [x] `/gastos`, `/campanas`: alta y listado.
- [x] `/reportes`: ventas por unidad de negocio, mayoristas (solicitudes/
      confirmadas/conversión), producción por etapa, stock crítico,
      productos más vendidos — todo calculado sobre tablas que ya
      existían, sin esquema nuevo.
- [x] `/dashboard` reemplaza el placeholder de la Fase 1 por la pantalla
      "Hoy" real: ventas/cobrado/pendiente del mes (sólo
      `owner`+`operations`), "Necesita atención" (pedidos atrasados,
      mayoristas sin revisar, producción activa, cuotas pendientes) y
      próximos eventos, para cualquier rol.
- [ ] **Pendiente** (no bloqueante, mismo motivo que en Fase 8): ni
      "Nuevo pedido" ni "Nueva campaña" tienen todavía un selector para
      asociar `orders.campaign_id` — se puede setear a mano por SQL
      mientras tanto.

## Fase 9.5 — Calendario, workshops públicos y correcciones operativas ✅

Intercalada antes de cerrar la Fase 10 definitiva, a pedido explícito.
Extiende el modelo existente (talleres, eventos, clientes) — no crea
ningún sistema paralelo.

- [x] **`/calendario`**: vista semanal (grilla en desktop, agenda vertical
      en mobile — mismo markup, responsive por CSS) con navegación
      anterior/hoy/siguiente, filtro por tipo. Consume tres fuentes de
      sólo lectura: `workshop_groups` (clases, ahora con
      `weekday`/`start_time`/`end_time` estructurados), `events`
      (workshops/ferias), y la tabla nueva `special_dates` (fechas que no
      pertenecen a ningún otro dominio). Ninguna fila se duplica para
      mostrarse en el calendario.
- [x] **Workshops públicos**: `events` ganó `slug`, `description`,
      horarios, `address`, `image_path`, `additional_info`,
      `payment_account_id`, `is_registration_open`. Nuevo set de estados
      (`draft`/`published`/`full`/`completed`/`cancelled`/`archived`,
      reemplaza al de la Fase 8) con historial automático
      (`event_status_history`). `/workshops/[slug]`: página pública
      mobile-first, mismo design system Pottery, con formulario de
      inscripción.
- [x] **Cupos sin sobreventa**: `register_for_workshop()` (RPC,
      `SECURITY DEFINER`) bloquea la fila de `events` con `FOR UPDATE`
      antes de contar inscriptos — dos inscripciones casi simultáneas se
      serializan, la segunda vuelve a contar después de que la primera
      confirmó. Nunca depende del frontend.
- [x] **Pago por transferencia**: `payment_accounts` ganó `alias` y
      `holder_name`; el workshop se asocia a una cuenta existente
      (nunca duplicada). La página pública y la pantalla de confirmación
      muestran sólo esos dos campos + nombre, vía `payment_account_public_view`
      — nunca la cuenta completa.
- [x] **Inscripción vs. contacto**: `event_registrations.participant_name`
      cubre el caso "mamá anota a su hijo" sin crear un segundo cliente.
- [x] **Inscripción ≠ pago**: `status` (pending/confirmed/cancelled/
      attended/no_show) y `payment_status` (pending/partial/paid) son ejes
      independientes — mismo patrón que pedidos y pagos.
- [x] **Fechas especiales**: tabla `special_dates` (título, fecha,
      categoría, `recurs_yearly`), gestionada desde `/calendario`.
- [x] **WhatsApp**: `lib/customers-shared.ts` (helpers puros, usables
      desde componentes cliente) ganó un parámetro de mensaje opcional.
      Agregado en el roster de talleres y la lista de inscriptos a
      eventos — ya existía en clientes y pedidos.
- [x] **Borrado seguro / archivo**: 5 funciones RPC
      (`delete_customer_safe`, `delete_workshop_group_safe`,
      `delete_event_safe`, `delete_enrollment_safe`,
      `delete_registration_safe`), todas `owner`-only, todas rechazan el
      borrado si existe historial real y explican por qué. Archivar
      (`archived_at`) queda disponible para `operations` también. Ver
      `docs/business-rules.md` para la tabla completa.
- [x] **Tests**: 13 tests nuevos (37 en total) — `slugify`, schemas de
      evento/inscripción pública, WhatsApp con mensaje. La lógica de
      cupos/concurrencia vive en el RPC (Postgres), no en TypeScript —
      sigue pendiente de tests de integración contra una base de test
      real (ver `docs/testing.md`).

## Fase 10 — Optimización ⏳ (en progreso)

- [x] **Auditoría de seguridad** — revisión completa de las políticas RLS
      de las 10 migrations anteriores. Encontró y corrigió 3 problemas
      reales: `profiles.is_active` no se verificaba en ningún lado
      (desactivar a alguien no le cortaba el acceso); un pedido podía
      retroceder de estado y duplicar la reserva de stock + la orden de
      producción generada al confirmarlo dos veces; la función pública
      mayorista no tenía límite de líneas en el carrito. Las tres,
      corregidas con su propia migration.
- [x] **Tests** — Vitest instalado, 24 tests sobre la lógica más
      riesgosa que es testeable sin una base de datos real: validación
      del carrito mayorista (extraída a `lib/wholesale-cart.ts` para que
      dejara de vivir sólo dentro del componente), schemas de pedidos y
      solicitud mayorista, normalización de WhatsApp. Ver
      `docs/testing.md` para lo que queda pendiente (todo lo que vive en
      triggers/RPCs de Postgres necesita una base de test real, no sólo
      Vitest).
- [x] **Confirmaciones en acciones destructivas** (sección 69) — cancelar
      pedido, cancelar orden de producción, cancelar inscripción a un
      evento, dar de baja a un alumno.
- [x] **Mobile** — la barra lateral desaparecía en mobile sin ningún
      reemplazo; ahora hay un menú hamburguesa con el mismo panel en un
      drawer.
- [ ] **Pendiente**: paginación en listados grandes (`/clientes`,
      `/productos`, `/pedidos`, `/pagos` traen todo sin límite —
      aceptable al volumen actual, revisar cuando crezca), auditoría de
      accesibilidad, tests E2E con Playwright contra una base de test
      real, revisión de índices adicionales si aparecen queries lentas
      con datos reales.

## Simplificaciones deliberadas para el MVP

Decisiones tomadas para no sobrediseñar antes de tener uso real (sección
70/90 del brief original) — revisar si en algún momento dejan de alcanzar:

- **Sin MRP/recetas (BOM)** en producción: se registra consumo manual de
  materia prima primero; recetas por producto quedan para cuando el
  volumen lo justifique.
- **Sin motor contable completo**: `payment_accounts` da visibilidad de
  caja, no reemplaza a un contador ni genera balances formales.
- **Sin integración de pago de WhatsApp Business API** en el MVP: se usa
  el link `wa.me` con número normalizado; la API paga queda para cuando
  haya volumen que la justifique.
- **Sin sincronización automática con Tienda Nube**: los pedidos ya
  reservan `external_source`/`external_order_id` para no tener que
  rediseñar el modelo cuando se implemente, pero la sync en sí no es parte
  de ninguna fase todavía.
- **Repetir pedido mayorista** (recompra con un clic): se deja la
  arquitectura lista (historial de pedidos por cliente), pero la función
  en sí no es parte del release público inicial del portal.
