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
