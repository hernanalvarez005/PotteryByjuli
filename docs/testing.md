# Testing — Pottery

## Qué se usa

- **Unit**: Vitest (`npm test`), instalado en la Fase 10. Cubre lógica
  pura de TypeScript — schemas zod y funciones sin efectos secundarios.
  Deliberadamente **no** cubre las reglas que viven en Postgres (triggers,
  funciones RPC como `set_order_status`, `submit_wholesale_request`,
  `complete_stock_transfer`) — esas son las que realmente mueven stock,
  dinero y cupos, y probarlas de verdad requiere una base Supabase de test
  (integración), no un mock. Ver "Cobertura pendiente" abajo.
- **E2E**: Playwright — todavía no instalado; se suma cuando haya que
  probar un flujo de punta a punta contra una base de test real.

## Qué está cubierto hoy

- `lib/wholesale-cart.test.ts`: `validateWholesaleCart` — mínimo por
  monto, mínimo por piezas totales, mínimo por producto, múltiplos,
  cuánto falta para cada uno, y que todo junto habilite el envío. Es la
  lógica con más superficie de error de negocio de todo el proyecto
  (sección 10 del brief original), y la única razón por la que vale la
  pena haberla sacado de `cart-sheet.tsx` a un archivo propio.
- `schemas/orders.test.ts`, `schemas/wholesale.test.ts`: validación de
  los formularios de pedido y de solicitud mayorista (campos requeridos,
  UUIDs, al menos un ítem, email opcional pero bien formado si está).
- `lib/customers.test.ts`: nombre para mostrar y normalización del link
  de WhatsApp (agrega `54` cuando falta, no lo duplica cuando ya está,
  agrega el mensaje prellenado URL-encoded cuando se pasa uno — Fase 9.5).
- `lib/slug.test.ts` (Fase 9.5): `slugify` — minúsculas, tildes removidas
  (`Cerámica` → `ceramica`), espacios y símbolos a guiones, sin guion al
  principio/final.
- `schemas/events.test.ts` (Fase 9.5): `slugSchema` (rechaza mayúsculas,
  espacios, guion al borde), `eventSchema` (capacidad > 0, el checkbox de
  inscripción abierta desmarcado = `false`, no `undefined`),
  `publicRegistrationSchema` (WhatsApp es el único campo realmente
  obligatorio del form público — es el único canal de seguimiento).
- `lib/import/csv.test.ts`: parser CSV/TSV a mano — delimitador dentro de
  comillas, newline literal dentro de un campo (las descripciones HTML de
  Tienda Nube lo tienen), comilla escapada `""`, fila final sin newline.
- `lib/import/tiendanube.test.ts`: `27,500.00` → `27500` (nunca `27.5`),
  detección de los 4 productos legacy "SEÑA" por nombre, agrupar N filas
  de variante bajo un solo producto (nunca N productos), mantener una
  variante con stock 0 en vez de descartarla, nunca aplicar el precio
  promocional como precio base, merge de una variante duplicada sumando
  stock. Un test de punta a punta corre el parser completo contra un
  fragmento con la forma real del export.
- `lib/import/students.test.ts`: agrupar alumnas por grupo con el weekday
  ISO correcto, nunca fusionar dos personas por compartir sólo el nombre
  de pila (`Cami Pagella` ≠ `Cami Frigerio`), un nombre de una sola
  palabra no inventa apellido.
- `tests/no-inline-handlers-in-server-components.test.ts` (post-lanzamiento
  P0): escaneo estático de todo Server Component bajo `app/` — falla si
  alguno pasa un closure inline como prop tipo `on*` a un Client
  Component. Regresión directa del bug productivo de Calendario → Clase;
  verificado que detecta el código roto original antes del fix.
- `lib/inventory.test.ts`: `summarizeStockByProduct` — el total agregado
  es la suma real de cada ubicación, nunca el mismo número repetido en
  todas; una ubicación con stock 0 sigue siendo su propia fila, no se
  omite.
- `lib/workshop-dues.test.ts`: estado mostrado (pendiente/parcial/pagada)
  siempre derivado de `amount` vs. suma de `payments`, nunca "sin
  registro = pendiente" tratado como el mismo caso que "pendiente real";
  el ejemplo de facturación vs. cobranza del brief (sección 62) verificado
  exactamente; `previousPeriod`/`nextPeriod` cruzando fin de año.
- `lib/calendar.test.ts`: `entriesForDate` (una clase recurrente entra por
  weekday, un workshop por fecha exacta, orden cronológico, filtro por
  tipo), `monthGridDays` (siempre Lunes a Domingo, múltiplo de 7 días).
- `lib/pricing.test.ts`: el ejemplo de ajuste masivo del brief (sección
  65, +5%) verificado exacto; redondeo al peso entero; una disminución
  nunca deja un precio negativo.
- `lib/image-url-import.test.ts`: rechazo de esquemas no-http(s),
  `localhost`, IPs privadas/loopback/link-local (incluye el rango de
  metadata de nube), validación de `Content-Type`.
- `schemas/workshops.test.ts`: `monthly_fee` opcional en el grupo,
  formato `AAAA-MM` exigido en el período de una cuota, un pago de
  cuota requiere importe positivo.

## Cobertura pendiente (necesita una base de test, no sólo Vitest)

Las reglas más importantes del sistema viven en las migrations de
Supabase, no en TypeScript — un test unitario no las alcanza. Cuando
exista un proyecto Supabase de test (separado del de producción), estas
son las pruebas de integración con más impacto, en orden:

1. **`set_order_status`**: confirmar reserva sólo lo disponible y genera
   la orden de producción por la diferencia; entregar consume la
   reserva; cancelar la libera; el estado nunca retrocede (fix de la
   Fase 10).
2. **`submit_wholesale_request`**: rechaza un carrito por debajo de
   cualquier mínimo, ignora el precio que mande el cliente y usa el del
   servidor, no permite más de 200 líneas.
3. **`complete_stock_transfer`**: atómica — si falta stock de un
   producto, no se mueve ninguno.
4. **`complete_production_order`**: la cantidad correcta impacta stock,
   la merma queda registrada.
5. **`check_workshop_capacity`/`check_event_capacity`**: no permiten
   sobrevender un cupo, ni con dos inscripciones concurrentes.
6. **`register_for_workshop`** (Fase 9.5): dos llamadas concurrentes para
   el último lugar de un workshop nunca terminan las dos en `confirmed`
   (el lock `for update` sobre `events` serializa el conteo); intentar
   inscribirse a un workshop `draft`, `cancelled` o con
   `is_registration_open = false` es rechazado por la función, no por el
   frontend; el precio que queda en la inscripción es el vigente al
   momento de inscribirse, no una referencia al `events.price` actual
   (snapshot histórico); un WhatsApp repetido reutiliza el `customer`
   existente en vez de duplicarlo.
7. **`delete_customer_safe` / `delete_workshop_group_safe` /
   `delete_event_safe` / `delete_enrollment_safe` /
   `delete_registration_safe`** (Fase 9.5): cada una debe rechazar el
   borrado (con un mensaje explicando qué lo bloquea) apenas existe una
   fila relacionada, y las cinco deben rechazar la llamada si quien la
   invoca no es `owner` — ver la tabla de la sección "Nunca borrado
   físico con historial relacionado" en `docs/business-rules.md`.
8. **`special_dates` con `recurs_yearly`** (Fase 9.5): una fecha especial
   cargada en un año anterior debe seguir apareciendo en el calendario de
   los años siguientes en el mismo mes/día, sin duplicarse si el rango
   consultado abarca más de un año.
9. **`generate_monthly_dues`** (post-lanzamiento): verificado manualmente
   en vivo (34 alumnas activas, 1 grupo con `monthly_fee` → 7 generadas /
   27 sin cuota; segunda corrida → 0 generadas / 7 existentes) — falta
   automatizar como test de integración. Pendiente además: dos llamadas
   *concurrentes* de "Generar cuotas" para el mismo período (la
   constraint `unique(enrollment_id, period)` debería bastar, pero no
   está probado bajo carrera real).

## Checks obligatorios antes de cerrar cualquier fase

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Nunca se ignoran errores de TypeScript ni se desactiva ESLint para
destrabar un commit.

## Flujos E2E críticos (Playwright), en el orden en que van a existir

1. **Minorista**: crear cliente → crear pedido → cobrar → descuenta stock.
2. **Mayorista público, camino feliz**: abrir `/mayorista` → agregar
   productos → cumplir mínimos → completar datos → enviar solicitud →
   aparece en el backoffice con el snapshot correcto.
3. **Mayorista público, camino inválido**: carrito por debajo del mínimo →
   el sistema bloquea el envío y explica qué falta.
4. **Stock**: transferir La Plata → Tres Lomas → ambos stocks quedan
   correctos, ninguno a mitad de camino si algo falla.
5. **Producción**: crear orden → completarla → el stock sube exactamente
   lo declarado.
6. **Workshop (interno)**: registrar persona → cobrar → ocupa un cupo (y
   no permite pasarse del cupo total).
7. **Workshop público, camino feliz** (Fase 9.5): publicar un workshop en
   el backoffice → abrir `/workshops/[slug]` sin sesión → completar el
   form → aparece la pantalla de confirmación (nombre, fecha, precio,
   alias — nunca "pago confirmado") → la inscripción aparece en el panel
   de inscriptos del backoffice con `payment_status = pending`.
8. **Workshop público, cupo agotado**: con el último lugar ocupado, la
   página pública muestra "Cupo completo" y bloquea el envío del form
   (nunca lo esconde en silencio); dos pestañas inscribiéndose al mismo
   tiempo para el último lugar — sólo una queda `confirmed`.
9. **Workshop público, borrador**: un workshop en `draft` nunca debe ser
   accesible en `/workshops/[slug]`, aunque se conozca el slug exacto.
10. **Calendario → clase → alumna → ficha** (post-lanzamiento, sección
    59 — obligatorio por ser regresión de un bug productivo real): login
    → `/calendario` → click en una clase → el detalle carga sin error →
    la lista de alumnas es visible → click en una alumna → abre su ficha
    de cliente. Verificado manualmente contra producción con el fix del
    P0; falta automatizar.
11. **Cuotas de un mes**: cargar `monthly_fee` en un grupo → "Generar
    cuotas" → aparecen con estado Pendiente → registrar un pago parcial
    → estado Parcial, saldo correcto → completar el pago → estado
    Pagada → se refleja en `/clientes?segment=students` y en la ficha
    ("Último mes pago"). Verificado manualmente contra producción (y
    los datos de prueba, limpiados después); falta automatizar.
