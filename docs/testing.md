# Testing — Pottery

## Qué se usa

- **Unit**: Vitest (`npm test`), instalado en la Fase 10. No necesita
  base ni variables de entorno; excluye `*.integration.test.ts`. Cubre lógica
  pura de TypeScript — schemas zod y funciones sin efectos secundarios.
  Deliberadamente **no** cubre las reglas que viven en Postgres (triggers,
  funciones RPC como `set_order_status`, `submit_wholesale_request`,
  `complete_stock_transfer`) — esas son las que realmente mueven stock,
  dinero y cupos, y probarlas de verdad requiere una base Supabase de test
  (integración), no un mock. Ver "Cobertura pendiente" abajo.
- **Integración**: Vitest (`npm run test:integration`), archivos
  `*.integration.test.ts` contra **Supabase local**. Ver "Tests de
  integración" más abajo.
- **E2E**: Playwright (`npm run test:e2e`), instalado en la extensión del
  checkout mayorista (comprador/PDF/WhatsApp). Corre **exclusivamente
  contra Supabase local** (`supabase start`), nunca contra producción —
  decisión explícita de la usuaria, incluso con datos ficticios limpiados
  después (a diferencia de la verificación manual de los P0 anteriores,
  que sí se hizo contra producción). Ver "Entorno E2E local" más abajo.

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
  `wholesale.test.ts` cubre además la regresión del P0 de checkout
  ("Invalid input: expected string, received null"): un checkout completo
  con **todos** los opcionales en `null` explícito (no sólo `""`), un
  Nombre/WhatsApp en `null` rechazado con el mensaje propio del campo (no
  el genérico de Zod), y un payload con la forma de una fila de cliente
  existente (columnas opcionales en `null`, nunca `undefined`).
- `lib/zod-helpers.test.ts`: los builders compartidos que resuelven esa
  regresión (`optionalString`/`optionalInteger`/`optionalMoneyAmount`/
  `requiredString`) — `null`, `undefined` y `""` se tratan igual en un
  campo opcional; un campo requerido falla con su propio mensaje ante
  cualquiera de las tres formas, nunca con el texto genérico de Zod.
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
- `lib/wholesale-anon-access.integration.test.ts` (P0 — catálogo
  mayorista vacío para `anon`): corre contra el proyecto Supabase real
  (no uno de test — no existe todavía) usando sólo la anon key, nunca
  escribe nada. Confirma el camino completo end-to-end (`anon` lee la
  lista `wholesale`, un `wholesale_product_rules.is_public`, y el precio
  real correspondiente), que `retail` sigue bloqueada, y los negativos de
  seguridad (`customers`/`payments`/`orders`/`inventory_movements`
  vacíos; `cost_estimate` rechazado con `42501`, no sólo `null`). Se
  salta automáticamente (`describe.skipIf`) si no hay credenciales
  disponibles en el entorno.
- `lib/phone.test.ts`: normalización de WhatsApp para el checkout mayorista
  — agrega el "9" móvil argentino cuando falta (con o sin el prefijo
  puesto, distintos códigos de área), respeta números de otros países tal
  cual, nunca tira excepción ante un input inválido/vacío/con letras.
- `lib/wholesale-pdf.test.ts`: el documento generado contiene el código de
  pedido, comprador, productos y el total correctos, y el rótulo
  "SOLICITUD PENDIENTE DE CONFIRMACIÓN"; omite un campo opcional sin valor
  en vez de imprimir una línea vacía; y el test histórico obligatorio —
  generar dos documentos con precios/condiciones distintos nunca contamina
  el primero ya renderizado (el checkout mayorista es 100% histórico, ver
  `docs/business-rules.md`).
- `schemas/wholesale.test.ts` (extendido): los nuevos campos obligatorios
  (apellido, email, razón social, ciudad, provincia) cada uno rechazado
  con su mensaje propio ante `null` o `""`; `address`/`postal_code`
  opcionales en sus tres formas.
- `lib/wholesale-pdf-storage-security.integration.test.ts`: mismo patrón
  que `wholesale-anon-access` (read-only, seguro sin gatear) — `anon` no
  puede listar el bucket `order-attachments` (Storage filtra filas igual
  que RLS: 200 con lista vacía, nunca un objeto real) ni leer un path
  adivinado sin signed URL.
- `e2e/wholesale-checkout.spec.ts` (Playwright, ver "Entorno E2E local"):
  flujo completo anónimo con verificación de datos (cliente, comercio,
  items, total, PDF, WhatsApp con el código correcto) y el caso de campo
  obligatorio faltante.

## Entorno E2E local

El checkout mayorista completo (crea cliente + pedido + PDF real en
Storage) no es seguro de correr repetidamente contra producción, ni
siquiera limpiando después — quema números de secuencia `MAY-000XXX` que
no se recuperan. En vez de eso, corre contra un Postgres local efímero:

```bash
supabase start        # levanta Postgres/Auth/Storage local vía Docker
                       # (o colima si no hay Docker Desktop instalado)
npm run test:e2e       # reusa un `next dev` en :4400 si ya está corriendo,
                       # o levanta uno nuevo con .env.development.local
```

`supabase/seed.sql` carga automáticamente (en `supabase start` y en
`supabase db reset`) un catálogo mayorista mínimo — nunca se aplica a
producción, el CLI no lo incluye en `db push`. `.env.development.local`
(gitignored) debe tener las credenciales que imprime `supabase start`
(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`) — Next.js las prioriza automáticamente sobre
`.env.local` en modo desarrollo, sin tocar las credenciales de producción.

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

## Tests de integración (Supabase local)

Los `*.integration.test.ts` crean y borran datos de verdad (pedidos,
stock, pagos) llamando a los RPC reales, así que corren **sólo contra
Supabase local**, nunca contra producción.

| Comando | Qué corre |
| --- | --- |
| `npm test` | Unit (38 archivos). Sin base, sin variables. |
| `npm run test:integration` | Integración (43 archivos), con gate de entorno. |
| `npm run test:all` | Los dos, en ese orden. |

**Gate.** `npm run test:integration` arranca con
`tests/support/integration-global-setup.ts` y **falla sin correr nada** si:

- falta alguna de `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  o `SUPABASE_SERVICE_ROLE_KEY`;
- la URL no es local (se parsea el hostname: sólo `127.0.0.1`, `localhost`
  o `[::1]` — un `.includes("localhost")` no alcanza);
- Supabase local no responde (`supabase start`).

Las variables se toman del shell o, si faltan, de `.env.development.local`
en la raíz del repo (Supabase local). **Nunca** se lee `.env.local`: apunta
a producción. Antes cada archivo hacía `describe.skipIf(!hasCredentials)` y
un `npm test` sin variables los salteaba en silencio y daba verde sin haber
probado nada; ahora el skip por entorno es un error. Los tests del propio
gate: `tests/integration-env.test.ts`.

> **Git worktrees:** `.env.development.local` está en `.gitignore`, así que
> un worktree nuevo no lo tiene. Copialo (o exportá las variables) desde el
> checkout principal antes de correr la integración.

**Regla: cada suite limpia lo que crea.** Usar `cleanupFixtures()` de
`tests/support/fixture-cleanup.ts` desde un `afterAll` (corre aunque un
assertion falle):

- registrar en cada `it`/helper los IDs exactos que se crean
  (productos, pedidos, condiciones, clientes, categorías) — nunca borrar por
  patrón de nombre;
- el helper borra en orden de FK (pedidos → movimientos/reservas →
  productos → condiciones y sus `price_lists` → clientes/categorías), en
  tandas de 50 ids y **lanza si algún borrado falla**;
- nunca toca `retail`, `wholesale` ni la condición `general`;
- no dejar el cleanup inline al final de un `it`: si un assertion falla
  antes, no corre. Y nunca un `.in()` con cientos de ids (HTTP 414).

Por qué importa (bugs reales, 2026-09): `products.delete()` falla en
silencio si el producto tiene ventas (`order_items`) o movimientos
(`inventory_movements`, ambos `NO ACTION`); borrar una `price_condition`
falla mientras un pedido la referencia (`orders.price_condition_id`); y un
`.in()` de 1.800 ids da 414. Sin mirar el error, cada corrida dejaba
basura: 48.600 pedidos sintéticos, ~700 productos y decenas de
`price_lists` `restricted-*` que ensuciaban `/precios`.

Un test tampoco puede depender de esa basura: el umbral de "catálogo
grande" en `product-search.integration.test.ts` es 2.000 variantes (el bug
de URL larga aparece ya con ~1.000), no un número que sólo se alcance con
fixtures viejos sin limpiar.

**CI remota:** todavía no corre integración (falta definir cómo provisionar
Supabase local ahí). Hasta entonces `npm run test:all` es un paso manual
obligatorio antes de mergear cambios que toquen SQL/RPC.

## Checks obligatorios antes de cerrar cualquier fase

```bash
npm run typecheck
npm run lint
npm run test:all   # unit + integración (Supabase local levantado)
npm run build
```

> **Worktrees y `typecheck`:** un worktree recién creado no tiene `.next`,
> y `app/layout.tsx` usa el tipo global `LayoutProps` que Next genera. Ahí
> `npm run typecheck` da `Cannot find name 'LayoutProps'` hasta correr
> `npm run build` (o `npx next typegen`). No es un bug del código.

Nunca se ignoran errores de TypeScript ni se desactiva ESLint para
destrabar un commit.

## Flujos E2E críticos (Playwright), en el orden en que van a existir

1. **Minorista**: crear cliente → crear pedido → cobrar → descuenta stock.
2. **Mayorista público, camino feliz** ✅ implementado
   (`e2e/wholesale-checkout.spec.ts`, contra Supabase local): abrir
   `/mayorista` → agregar productos → cumplir mínimos → completar datos →
   revisar → enviar solicitud → confirmación con código, WhatsApp y PDF →
   verificado también a nivel de datos (cliente, pedido, items, snapshot).
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
12. **Mayorista público, checkout con reintento** (post-lanzamiento P0 —
    "Invalid input: expected string, received null"): completar sólo
    Nombre y WhatsApp (todo lo demás vacío) → enviar → confirmación con
    `human_code`. Reenviar el mismo `client_request_id` (doble click,
    timeout, reintento tras un error visual) → debe devolver el mismo
    `human_code`, nunca crear un segundo pedido. Verificado manualmente
    contra producción con el fix (formulario anónimo + reintento directo
    de la RPC con el mismo id), datos de prueba limpiados después; falta
    automatizar.
