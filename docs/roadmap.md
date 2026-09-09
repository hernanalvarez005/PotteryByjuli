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

## Fase 8 — Workshops + Ferias

Eventos, cupos sin sobreventa, inscripción + pago, asignación/devolución
de stock, costos y resultado.

## Fase 9 — Finanzas + Reportes

Gastos, cuentas/caja, dashboards por unidad de negocio, reportes de
ventas/productos/mayoristas/stock/producción/talleres/workshops.

## Fase 10 — Optimización

UX, mobile, accesibilidad, performance, auditoría de seguridad (RLS, Auth,
Storage, acceso anónimo mayorista), índices, tests, edge cases.

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
