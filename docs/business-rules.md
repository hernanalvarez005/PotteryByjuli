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
| `products`, `orders`, `production_orders`, etc. (fases anteriores) | No | `is_active` / estado | Siempre — tienen historial por diseño desde que existen |

En todos los casos: eliminar una inscripción/enrollment **nunca** borra al
`customer` — María puede dejar el taller y seguir existiendo en el CRM con
sus compras.

## Seguridad del portal mayorista público

El acceso anónimo (Fase 5) sólo puede: leer productos mayoristas activos y
marcados como públicos, leer imágenes públicas, leer las condiciones
necesarias para armar el pedido, y crear una solicitud válida. Nunca puede
leer clientes, pedidos ajenos, stock interno, costos ni reportes. Esto se
refuerza en RLS, no sólo ocultando UI.

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
