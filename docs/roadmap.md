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

## Fase 3 — Pedidos + Pagos

Motor central de `orders`/`order_items` para minorista y personalizados
básicos, estados, `payments`, saldo, canal de origen/cierre, entrega.
**Resultado**: Pottery puede operar ventas reales desde el sistema.

## Fase 4 — Stock

Ubicaciones, ledger de movimientos, disponible vs. reservado,
transferencias atómicas, alertas de stock mínimo.
**Resultado**: Juli conoce el stock real por ubicación y su trazabilidad.

## Fase 5 — Mayoristas (prioridad de negocio más alta)

Configuración y reglas mayoristas, catálogo público (`/mayorista`), carrito
con validación en vivo, formulario de solicitud, snapshot de
precio/condiciones, estados de la solicitud, conexión a CRM.
**Resultado**: Juli deja de mandar catálogo + Excel. Manda **un link**.

## Fase 6 — Producción

Órdenes de producción, etapas configurables, prioridades/fechas, conexión
con pedidos, ingreso a stock al finalizar, registro de merma sin
ocultarla.

## Fase 7 — Talleres

Grupos, alumnos (= `customers`), inscripciones, cuotas, asistencia.

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
