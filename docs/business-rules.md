# Reglas de negocio — Pottery

Reglas que no son obvias leyendo el código, y que cualquier cambio futuro
debería respetar. Si una regla de acá deja de ser cierta, actualizar este
documento en el mismo commit que el código.

## Núcleo compartido, no un sistema por unidad de negocio

Un producto, un cliente y un pedido son siempre la misma entidad sin
importar el canal. "Taza Clásica" existe una sola vez con precio minorista
y mayorista distintos, no dos filas en tablas separadas. Un cliente que
compró una taza, hizo un taller y tiene un comercio mayorista es **una**
fila en `customers`, distinguida por tags — nunca fichas duplicadas por
segmento.

Regla de decisión (sección 83 del brief original): ante la duda entre crear
una tabla/módulo nuevo o extender el núcleo compartido, se prefiere
extender — *salvo* que la naturaleza operacional sea realmente distinta.
Ejemplos ya resueltos:
- Pedido mayorista → sigue siendo `orders` (con su `business_unit_id`).
- Inscripción a un taller o evento → entidad propia (`workshop_enrollments`,
  `event_registrations`), porque su ciclo de vida (cupo, asistencia, cuota)
  no se parece al de un pedido de productos.

## Tres campos que nunca se mezclan en un pedido

1. **Origen comercial** (`origin_channel_id`): dónde conoció Pottery el
   cliente. Ej.: Instagram.
2. **Canal de cierre** (`closing_channel_id`): dónde se concretó. Ej.:
   WhatsApp.
3. **Medio de pago** (`payment_methods`, en `payments`, no en `orders`):
   cómo pagó. Ej.: transferencia.

Un mismo pedido puede tener origen Instagram, cierre WhatsApp, pago
transferencia, entrega en Tres Lomas — cuatro dimensiones independientes.

## Solicitud mayorista ≠ venta confirmada

Enviar un carrito desde el catálogo público crea una **solicitud**
(`status = requested`), no descuenta stock. Recién al **confirmar**:
- se reserva el stock existente;
- lo que falta genera necesidad de producción (`solicitado − disponible =
  necesidad`), mostrada explícitamente, sin obligar a crear manualmente
  cada orden de producción.

## Snapshots históricos

Un pedido guarda el precio, condiciones y mínimos vigentes **al momento en
que se hizo**, no una referencia al catálogo actual. Cambiar el precio
mayorista mañana no debe alterar ni un solo pedido histórico. Esto aplica
también a reportes: una venta de hace tres meses sigue mostrando el precio
de hace tres meses.

## Facturación ≠ cobranza

Un pedido de $100.000 no implica $100.000 cobrados. Ventas, cobros y saldo
pendiente se muestran siempre como tres números separados, nunca
colapsados en uno.

## Stock: físico, reservado, disponible

`disponible = físico − reservado`. Nunca se vende sobre el físico sin
descontar reservas — evita vender dos veces lo mismo. Una transferencia
entre ubicaciones (ej. La Plata → Tres Lomas) **no es una venta**: es
salida + entrada atómica en la misma operación; si una mitad falla, no
queda a mitad de camino.

## Reglas mayoristas configurables, no hardcodeadas

Mínimo monetario, mínimo de piezas, mínimo por producto, múltiplos, plazo,
condiciones de pago/envío y mensaje comercial se editan desde
Administración. El carrito público valida esto en vivo y explica **qué
falta** ("Te faltan $30.000 para el mínimo mayorista"), nunca un genérico
"pedido inválido". No se permite enviar un pedido que no cumple los
mínimos, salvo que Juli lo habilite explícitamente por configuración.

## Auditoría obligatoria

Cambios a precios, stock, pagos, estado de pedidos y configuración
mayorista quedan registrados (quién, qué, cuándo, valor anterior/nuevo).

## Checkout mayorista: campos obligatorios vs. opcionales

**Actualizado** — el checkout ahora pide datos completos del comprador
(persona de contacto + datos comerciales + ubicación) antes de un paso de
revisión, no sólo nombre y WhatsApp. Obligatorios: **Nombre, Apellido,
WhatsApp, Email, Razón social/Nombre del comercio, Ciudad, Provincia**.
Opcionales: CUIT, Instagram, Sitio web, Dirección, Código postal,
Observaciones. Un campo obligatorio ausente nunca debe fallar con un error
técnico genérico: tanto el schema (`schemas/wholesale.ts`) como la RPC
(`submit_wholesale_request`, como backstop si algo llama la función
directamente) muestran un mensaje específico por campo ("Falta el
nombre.", "Falta la razón social o el nombre del comercio.").

**Convención null/undefined/"" en el límite del formulario** (fijada por el
P0 del 2026-09-09/10, "Invalid input: expected string, received null"):
`FormData.get()` devuelve `null` — nunca `undefined` — para un campo
ausente del formulario, y una fila de Supabase también devuelve `null`
para una columna opcional sin valor. Todo campo opcional del checkout debe
tolerar las tres formas (`null`, `undefined`, `""`) de "sin valor" de forma
idéntica, normalizando a `""` en el formulario y `NULL` en la base. Nunca
se resuelve esto haciendo `.optional()` a secas ni repitiendo `valor ?? ""`
suelto en cada componente: se usan los builders compartidos de
`lib/zod-helpers.ts` (`optionalString`, `optionalInteger`,
`optionalMoneyAmount` para lo opcional; `requiredString` para lo
obligatorio, de forma que un `null` en un campo requerido también dispare
el mensaje propio del campo en vez del error genérico de Zod).

## Checkout mayorista: protección contra pedidos duplicados

El formulario genera un `client_request_id` (UUID) una única vez por
intento de checkout y lo reenvía en cada submit — incluido un reintento
por error visual, timeout o doble click. `submit_wholesale_request` revisa
ese id antes de crear nada: si ya existe un pedido con ese
`client_request_id`, devuelve el mismo `human_code` en vez de duplicar el
pedido (`orders.client_request_id`, índice único parcial). El id sólo se
renueva cuando el checkout anterior terminó en éxito y el carrito se
vació — nunca en un reintento del mismo intento.

## Checkout mayorista: normalización de teléfono

El WhatsApp del checkout se normaliza server-side (`lib/phone.ts`, con
`libphonenumber-js`) antes de guardarlo y antes de deduplicar. Corrige el
caso típico argentino: un número dado sin el marcador móvil ("11
2233-4455") resuelve como fijo según el plan de numeración oficial, pero
nadie lo dice así y WhatsApp lo exige — como este campo existe
específicamente para contactar por WhatsApp, se corrige a la forma móvil
cuando el país detectado es Argentina. Números de otros países se respetan
tal cual (nunca asumir que todo comprador es argentino). El formato
canónico guardado mantiene la misma forma que ya usaba `customers.whatsapp`
(dígitos, código de país sin "+"), así el dedup contra filas existentes
sigue funcionando sin backfill. **Limitación conocida, aceptada
deliberadamente**: filas de clientes previas a esta normalización pueden
tener un formato menos preciso (sin el "9" faltante) — no hay backfill
masivo de datos históricos en esta pasada.

## Checkout mayorista: deduplicación de clientes y conflictos de identidad

Antes de crear un cliente nuevo, `submit_wholesale_request` busca
coincidencias por whatsapp normalizado, email y CUIT, cada uno por
separado (nunca un `OR` combinado):

- **0 señales encontradas** → crea un cliente nuevo.
- **Todas las señales apuntan al mismo cliente** → lo reusa, completando
  sólo los campos que hoy están en `NULL` (`coalesce(existente, nuevo)`) —
  nunca pisa un valor ya cargado.
- **Señales distintas apuntan a clientes existentes distintos** (ej.
  WhatsApp de esta solicitud coincide con el Cliente A, pero el email
  coincide con el Cliente B) → **nunca se fusiona ni se modifica** A ni B.
  Se crea un cliente nuevo para esta solicitud puntual (la arquitectura
  exige un `customer_id`) y el conflicto queda registrado en
  `customer_identity_conflicts` para revisión manual — el backoffice
  muestra un aviso "⚠ Posible identidad duplicada" en la ficha de ese
  cliente y en el pedido mientras el conflicto siga sin resolver
  (`resolved_at is null`). No existe hoy una función de fusión automática
  de clientes — la reconciliación es manual.

## Checkout mayorista: el PDF es 100% histórico

El documento generado en el checkout (o regenerado después desde el
backoffice si la generación original falló) se arma exclusivamente con
datos ya congelados en el pedido: `order_items.unit_price` y cantidades,
`orders.wholesale_terms_snapshot` (condiciones), y
`orders.wholesale_buyer_snapshot` (los datos del comprador **tal como se
enviaron en esa solicitud puntual** — nunca un join en vivo a `customers`,
porque esa fila puede cambiar después por otro pedido, un merge
fill-null-only, o una edición manual en el CRM). Lo único que sí se lee en
vivo es lo puramente institucional (logo, nombre de Pottery) — nunca
precio, mínimos, plazos, condiciones o datos del comprador actuales. Si
Juli cambia precios o condiciones después, el documento original no se
reescribe; representa "la solicitud original" tal cual se pidió.

## Checkout mayorista: documento privado y signed URLs

El PDF se guarda en el bucket privado `order-attachments`
(`{order_id}/{human_code}.pdf` — el UUID del pedido es la barrera real de
seguridad, el código humano es sólo el nombre de archivo) — nunca público,
nunca con una ruta adivinable. El link que viaja en el mensaje de WhatsApp
del comprador es una signed URL de 72 horas (preferencia explícita:
"24–72hs si es operacionalmente suficiente" — documentado acá como el
tradeoff usabilidad/privacidad elegido). Esto no es un problema si Juli
tarda más en revisar: el backoffice genera su propia signed URL corta
(~60s) bajo demanda cada vez que abre "Ver PDF", con su sesión autenticada
normal — no hace falta el service role para esa lectura, la policy de
`order_attachments_staff_read` ya permite `select` a cualquier usuario
`authenticated`.

Subir el PDF y firmar la URL del comprador sí requiere el service role,
porque el Server Action del checkout corre como `anon` a propósito (sin
sesión) pero necesita hacer esa operación puntual y confiable de servidor
— análogo a por qué la RPC de escritura ya corre como `security definer`.
Ese cliente admin vive en `lib/supabase/admin-server-only.ts`, deliberada y
explícitamente separado de `scripts/_supabase-admin.ts` (ese archivo nunca
se importa desde `app/`; éste es la única excepción, y no exporta el
cliente crudo — sólo tres funciones puntuales).

## Checkout mayorista: un fallo de PDF nunca esconde ni duplica un pedido

La RPC (transacción atómica) crea cliente+pedido+items primero e
independientemente. La generación del PDF y su subida pasan después, en el
mismo Server Action, envueltas en `try/catch` que nunca hace fallar la
respuesta — si el PDF falla, `humanCode`/`orderId` igual se devuelven,
`documentUrl` queda `null`, y la pantalla de éxito funciona igual sin el
link (nunca se muestra un error que sugiera reintentar, que sí podría
terminar en un pedido duplicado). La ausencia de una fila en
`order_attachments` para ese pedido es la señal — no hace falta una
columna de estado nueva. Desde el backoffice, un pedido sin documento
muestra "Generar resumen PDF" (usa los mismos datos ya congelados del
pedido); un pedido que ya tiene uno muestra "Ver PDF" — nunca "regenerar"
un documento existente, para no reescribir silenciosamente la solicitud
original.

## Checkout mayorista: WhatsApp de Pottery y "se abrió" vs. "se envió"

El número al que apunta el botón "Enviar pedido por WhatsApp" del
catálogo público (`wholesale_settings.business_whatsapp`, editable sólo
por la owner desde Configuración) nunca está hardcodeado en un componente.
Si no está configurado, ese botón simplemente no se muestra — nunca un
link roto. Al hacer click se registra `orders.whatsapp_share_opened_at`
vía una RPC chica (`mark_wholesale_whatsapp_share_opened`, porque `anon`
no tiene policy de update sobre `orders`) — esto **nunca** significa que
el mensaje se envió de verdad, sólo que el botón se abrió; la app no puede
saber con certeza si el comprador completó el envío en WhatsApp.

## Nunca borrado físico con historial relacionado

`is_active` / `archived_at` en vez de `DELETE`, siempre que exista una
venta, pedido o movimiento que referencie la fila. Desde la Fase 9.5 esto
se aplica en el código, no sólo en la intención: cada entidad borrable
tiene una función RPC `delete_*_safe` que cuenta las relaciones antes de
borrar, y sólo `owner` puede invocarlas.

| Entidad | Hard delete permitido | Archivar/dar de baja | Condición para hard delete |
|---|---|---|---|
| `customers` | Sí (`delete_customer_safe`) | `is_active = false` | 0 pedidos, 0 inscripciones a taller, 0 inscripciones a evento |
| `workshop_groups` | Sí (`delete_workshop_group_safe`) | `archived_at` | 0 alumnos inscriptos (en cualquier estado) |
| `events` (workshops/ferias) | Sí (`delete_event_safe`) | `status = 'archived'` / `'cancelled'` | 0 inscripciones, 0 pedidos, 0 transferencias de stock asociadas |
| `workshop_enrollments` | Sí (`delete_enrollment_safe`) | `status = 'cancelled'` (baja) | 0 registros de asistencia, 0 cuotas |
| `event_registrations` | Sí (`delete_registration_safe`) | `status = 'cancelled'` | `payment_status = 'pending'` (nunca se registró un pago) |
| `products` | Sí (`delete_product_safe`, individual; `bulk_delete_products_safe`, en lote) | `is_active = false` | 0 `order_items`, 0 `inventory_movements`, 0 `production_orders` (vía `product_variants`) |
| `orders`, `production_orders`, etc. (fases anteriores) | No | `is_active` / estado | Siempre — tienen historial por diseño desde que existen |

En todos los casos: eliminar una inscripción/enrollment **nunca** borra al
`customer` — María puede dejar el taller y seguir existiendo en el CRM con
sus compras.

**`stock_thresholds` no es historial, es configuración** (un umbral de
alerta que la usuaria cargó, "avisame cuando quede menos de X") — no
bloquea el borrado de un producto por sí solo. Como tampoco cascadea desde
`inventory_items`, `delete_product_safe`/`bulk_delete_products_safe` lo
limpian explícitamente antes de dejar que el borrado del producto cascadee,
para no toparse con un error crudo de FK por una fila que no es "historial
real". `inventory_reservations` no necesita chequeo propio: sólo se crean
junto a `order_items` al confirmar un pedido, así que `order_items = 0` ya
garantiza `inventory_reservations = 0` para ese producto.

## Seguridad del portal mayorista público

El acceso anónimo (Fase 5) sólo puede: leer productos mayoristas activos y
marcados como públicos, leer imágenes públicas, leer las condiciones
necesarias para armar el pedido, y crear una solicitud válida. Nunca puede
leer clientes, pedidos ajenos, stock interno, costos ni reportes. Esto se
refuerza en RLS, no sólo ocultando UI.

**RLS se evalúa también dentro de las policies, no sólo en la tabla
consultada** — un bug real (2026-09-09, P0 producción) lo probó: la
policy de `price_list_items` para `anon` hace un `EXISTS` que hace JOIN
contra `price_lists`; como `price_lists` no tenía ninguna policy de
`anon`, ese JOIN siempre volvía vacío y la policy de `price_list_items`
quedaba imposible de cumplir — el catálogo público se veía vacío aunque
products/variants/wholesale_product_rules estuvieran perfectamente
configurados. Regla para cualquier policy nueva que haga `EXISTS`/`JOIN`
contra otra tabla: esa otra tabla necesita su propia policy para el
mismo rol, o la policy que depende de ella nunca podrá cumplirse.

**RLS filtra filas, nunca columnas.** El mismo incidente encontró que
`products.cost_estimate` era legible por `anon` pidiéndolo explícito vía
API, aunque `lib/wholesale.ts` nunca selecciona esa columna — el GRANT de
tabla completa que Supabase le da a `anon` por default alcanza cualquier
columna sin importar qué pida la propia app. Cualquier tabla con una
columna sensible (costo, margen, notas internas) que además tenga una
policy de lectura para `anon`/`authenticated` de bajo privilegio necesita
un `REVOKE SELECT ON tabla FROM rol` + `GRANT SELECT (columnas seguras)
ON tabla TO rol` explícito — nunca asumir que "la app no lo pide" alcanza
como protección.

**Imagen atada a una variante inactiva (2026-09-10, tanda de mejoras
operativas)**: `product_images_select_public_wholesale` sólo exigía que el
producto estuviera activo y fuera público — nunca miraba
`product_images.variant_id`. Una imagen atada a una variante que después
se desactiva seguía siendo visible para `anon`, aunque esa variante ya no
apareciera en ningún selector. Corregido para exigir además que, si
`variant_id` no es null, esa variante también esté activa (una imagen
general, `variant_id is null`, nunca se ve afectada). El cambio sólo
achica acceso — test de regresión en
`lib/wholesale-image-variant-filter.integration.test.ts` confirma tanto
el caso nuevo (oculto) como que todo lo que ya era visible sigue
siéndolo.

## Seguridad del portal público de workshops (Fase 9.5)

Mismo criterio que el portal mayorista, pero sin RLS directa sobre
`events`/`payment_accounts` — anon lee exclusivamente a través de vistas
(`workshop_public_view`, `payment_account_public_view`,
`location_public_view`) que exponen sólo columnas explícitamente públicas
(nunca `cost_estimate`, `notes`, IDs internos, ni el resto de una cuenta
de pago más allá de alias/titular/nombre). `event_registrations` no tiene
ninguna vista ni policy pública: anon nunca lee inscriptos, ni para
contarlos — el conteo que ve (`confirmed_count`) es un agregado calculado
dentro de la vista misma, no una consulta que anon podría reproducir para
extraer filas individuales.

La única escritura posible para anon es `register_for_workshop()`, y el
frontend público nunca decide `status`, `payment_status`, `price` ni
`capacity` — todo eso lo resuelve el servidor dentro de la función.

## Calendario: una vista, no una fuente nueva de verdad

`/calendario` no tiene tabla propia para clases ni workshops — lee
`workshop_groups` (clases recurrentes, vía `weekday`/`start_time`),
`events` (workshops/ferias puntuales, vía `event_date`) y `special_dates`
(lo único que sí es una entidad nueva, para lo que no encaja en ningún
dominio existente). Nunca se genera una fila por cada ocurrencia futura de
una clase — el calendario simplemente le pregunta a `workshop_groups` "qué
grupos caen un martes" cada vez que se pide la semana.

## Cupos y concurrencia

Tanto para workshops (`event_registrations`) como para talleres
(`workshop_enrollments`), la validación de cupo vive en Postgres — un
trigger (`check_event_capacity` / `check_workshop_capacity`) que corre
`before insert or update`, nunca en el frontend. Para el flujo público de
workshops además se toma un lock de fila (`select ... for update` sobre
`events`) antes de contar inscriptos, así que dos inscripciones casi
simultáneas para el último lugar se resuelven en orden, nunca en paralelo:
la segunda vuelve a contar recién después de que la primera terminó.

## Inscripción a workshop ≠ pago

Igual que "solicitud mayorista ≠ venta confirmada" (más abajo): registrarse
a un workshop público asegura el lugar (`status = 'confirmed'`) pero nunca
asume que ya se pagó (`payment_status` arranca en `'pending'`). La pantalla
de confirmación se lo dice explícitamente a quien se inscribió.

## Argentina, moneda y horario

ARS, formato `$ 125.000` (sin decimales en la UI), fechas `DD/MM/YYYY`,
timezone `America/Argentina/Buenos_Aires`. Los timestamps se guardan en UTC
(`timestamptz`) y se formatean a hora local sólo en el borde de UI —
`lib/format.ts` es el único lugar que debería tener esta lógica.

## Importación de datos reales

`scripts/import-tiendanube.ts` y `scripts/import-current-students.ts`
cargan catálogo y alumnas reales sin crear ningún módulo paralelo — todo
entra por `products`/`product_variants`/`price_list_items`/
`inventory_movements` y por `customers`/`workshop_groups`/
`workshop_enrollments` de siempre. La lógica de mapeo vive en
`lib/import/*.ts` (pura, sin cliente de Supabase, testeada); los scripts
son sólo el I/O.

Reglas que estos scripts respetan y cualquier importador futuro debería
también:

- **Idempotencia por identidad externa**: `products.external_source` +
  `external_id` (único cuando ambos están seteados) — reimportar el mismo
  CSV nunca duplica un producto. Variantes se de-duplican por la
  constraint existente `(product_id, name)`; no hizo falta una columna
  nueva. Grupos/programas de taller se matchean por nombre exacto dentro
  del programa que crea el importador — no hay un id externo natural en
  un listado a mano.
- **Nunca pisa un valor que ya exista**: un precio o un movimiento de
  stock sólo se crea si no hay uno ya — así una corrida repetida (o
  reanudada después de un error a mitad de camino) nunca duplica ni
  sobrescribe algo que Juli pudo haber corregido a mano entre medio.
- **`movement_type = 'initial_import'`**: declara stock inicial sin
  fingir que fue una compra o una producción real — es la única forma de
  distinguir "esto lo trajo un import" de un movimiento operativo real en
  el ledger (`inventory_movements.reason` lleva además el `external_id`
  de origen).
- **Servicios legacy de Tienda Nube** (los 4 productos "... SEÑA", señas
  de talleres cobradas ahí antes de que este módulo existiera) se
  detectan por nombre (`/seña/i`) y se excluyen del catálogo físico —
  workshops se gestionan por su propio módulo (Fase 8/9.5), nunca como un
  producto con stock.
- **Ubicación del stock nunca se asume**: el script exige `--location=` en
  `--apply`; sin ese dato explícito, el `--dry-run` lo marca como "sin
  confirmar" y no hay default.
- **Duplicados de clientes**: sólo se matchea por nombre completo exacto
  (normalizado en mayúsculas/espacios) — nunca fuzzy-merge. Un nombre de
  pila repetido con apellido distinto se reporta como "potential conflict"
  para revisión humana, nunca se fusiona automáticamente.
- **Datos que el modelo actual no soporta** (precio promocional, peso/
  dimensiones, SEO, marca, tags) no se inventan una columna nueva para
  cada uno — se documentan en el reporte del `--dry-run`/`--apply` y quedan
  como decisión pendiente, nunca se pierden silenciosamente ni se aplican
  a un campo que significa otra cosa (ej.: el precio promocional jamás
  reemplaza `price_list_items.unit_price`).
- **Cupo de grupos importados**: como el listado a mano no traía el cupo
  máximo real, `workshop_groups.capacity` (que la constraint exige `> 0`)
  se cargó con la cantidad actual de alumnas como placeholder explícito —
  documentado en el reporte, a ajustar a mano en `/talleres` cuando se
  confirme el cupo real.

## Cuotas mensuales de talleres

El valor mensual vive en `workshop_groups.monthly_fee` (no en el
programa — el programa es sólo una categoría, todo lo demás operativo
—horario, cupo, ubicación— ya vivía en el grupo). Una alumna puede tener
`workshop_enrollments.monthly_fee` propio, que pisa el del grupo sólo
para ella — nunca al revés, y nunca reescribe el valor general.

"Generar cuotas" (`generate_monthly_dues(period)`) es idempotente por
construcción: inserta contra el `unique(enrollment_id, period)` que ya
existe desde Fase 7 con `ON CONFLICT DO NOTHING` — apretar el botón dos
veces para el mismo mes nunca duplica una cuota. El importe queda
grabado en el momento (`amount`) y nunca se recalcula después: si el
`monthly_fee` del grupo cambia en octubre, la cuota de septiembre sigue
en lo que costaba en septiembre — el mismo criterio de snapshot que ya
usan los pedidos.

**Pagada/Parcial nunca se guardan** — se calculan siempre sumando los
`payments` reales contra el `amount` de la cuota (`pagado ≥ importe` →
pagada; `0 < pagado < importe` → parcial; `pagado = 0` → pendiente),
igual que "Facturación ≠ cobranza" ya funciona para pedidos.
`workshop_dues.status` sólo guarda lo que **no** es derivable de pagos:
si la cuota fue cancelada. La primera versión de esta tabla (Fase 7)
guardaba `is_paid`/`paid_at`/`method_id` directo en la fila — una segunda
contabilidad paralela a `payments` — reemplazada porque nunca llegó a
tener filas reales en producción (seguro de reescribir sin backfill).

`payments` se generalizó para poder apuntar a una cuota además de a un
pedido: `order_id` pasó a nullable, se agregó `workshop_due_id`, y una
constraint exige que sea exactamente uno de los dos. Nunca "cuotas
tienen su propio pago" — es el mismo `payments` de siempre.

"Sin registro" ≠ "pendiente": la vista Alumnas y la ficha de cliente
distinguen explícitamente "Sin cuota generada" (todavía no se corrió
"Generar cuotas" para ese mes) de "Pendiente" (la cuota existe, no se
cobró) — nunca se asume lo segundo cuando es lo primero.

### Cargos extra sobre una cuota (2026-09-10, tanda de mejoras operativas)

Un cargo puntual como "Arcilla $8.500" se agrega ARRIBA de la cuota
mensual — nunca se inserta como `payment` (eso restaría del saldo en vez
de sumarlo). `workshop_due_items` guarda esas líneas: `amount` +
`concept_id` (catálogo chico en `workshop_due_concepts`, mismo patrón que
`payment_methods`/`sales_channels`, gestionado desde /configuracion).

**Sólo "anular", nunca hard delete** — decisión deliberada sobre la regla
condicional que se había sugerido inicialmente ("si no tiene pagos
asociados, borrar directo"): como los pagos se registran contra el TOTAL
de una cuota y no contra un cargo puntual, no hay forma de saber desde los
datos si un pago histórico ya "cubrió" un extra específico. Se usa una
única política uniforme (anular vía `voided_at`/`voided_by`, nunca borrar)
— un solo camino de código, coherente con el resto del proyecto
(historial de estados, movimientos de stock: todo append-only).
`workshop_due_items` **no tiene ninguna policy de update/delete** — ni
siquiera para la owner — la única forma de tocar una fila después de
insertada es la RPC `void_due_item` (`security definer`, igual patrón que
`mark_wholesale_whatsapp_share_opened`), que sólo puede setear
`voided_at`/`voided_by`. Es una garantía de base de datos, no sólo
disciplina de la UI.

**`computeDueSummary` (`lib/workshop-dues.ts`) es la única fuente de
verdad del total de una cuota** — Talleres, la ficha de alumna y el
dashboard/reportes la llaman todos, nunca reimplementan la suma de extras
o pagos por su cuenta (`tests/workshop-due-summary-single-source.test.ts`
lo confirma estáticamente). El estado ("Pagada"/"Parcial"/etc.) se deriva
siempre contra `totalDue` (cuota + extras), nunca sólo contra la cuota
base — así que agregar un extra a una cuota que hoy figura "Pagada" la
vuelve "Parcial" automáticamente, sin ningún caso especial: el estado
nunca se guarda, siempre se calcula.

## Stock por ubicación — nunca un número repetido

`getFinishedGoodsStock()` calcula físico/reservado/disponible por
`(inventory_item_id, location_id)` desde el ledger real — cada ubicación
tiene su propio número genuino, nunca el mismo valor copiado a las dos.
La vista "Todas" de `/stock` agrega esos números reales por producto
(con desglose visible por ubicación); una ubicación específica filtra a
sólo esa fila. Si algún día una ubicación nueva parece mostrar el mismo
stock que otra, es señal de un bug real — no del comportamiento
esperado, que siempre parte de movimientos con `location_id` propio.

## Ajuste masivo de precios

Sólo escribe sobre un `price_list_items` que ya existe — nunca crea un
precio donde no había uno (aumentar el 5% de "nada" no tiene sentido).
Redondea siempre al peso entero (`Math.round`), la misma convención que
ya usa toda la plataforma para ARS — no una regla nueva de redondeo a
miles. Un pedido histórico nunca se ve afectado: su `unit_price` ya
quedó copiado al momento de la venta, la actualización masiva sólo toca
`price_list_items` (el precio *vigente*, no el histórico). Cada
operación masiva deja una fila en `price_bulk_adjustments` (quién,
cuándo, qué lista, tipo, cuántos precios) — un fallo al grabar esa
auditoría nunca se oculta: se revierte la interpretación de "éxito" y se
muestra como advertencia, aunque los precios ya se hayan actualizado
correctamente (nunca se deshace un cambio real por un problema sólo de
auditoría).

## Imágenes de producto por URL — nunca un hotlink

Pegar una URL pública descarga la imagen server-side, valida que el
`Content-Type` sea realmente `image/jpeg|png|webp` y que pese menos de
10MB, y recién ahí la sube a Storage propio — el producto nunca queda
dependiendo de que un CDN externo (ej. Tienda Nube) seguirá sirviendo esa
URL. Protección SSRF en dos pasadas: se rechaza el hostname/esquema antes
de tocar la red (`localhost`, IPs privadas, el rango link-local que
incluye el endpoint de metadata de nube 169.254.169.254), y después se
resuelve DNS y se vuelve a chequear la IP real — un hostname
público-en-apariencia que resuelve a una dirección privada se bloquea
igual.
