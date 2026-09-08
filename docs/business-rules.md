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
venta, pedido o movimiento que referencie la fila.

## Seguridad del portal mayorista público

El acceso anónimo (Fase 5) sólo puede: leer productos mayoristas activos y
marcados como públicos, leer imágenes públicas, leer las condiciones
necesarias para armar el pedido, y crear una solicitud válida. Nunca puede
leer clientes, pedidos ajenos, stock interno, costos ni reportes. Esto se
refuerza en RLS, no sólo ocultando UI.

## Argentina, moneda y horario

ARS, formato `$ 125.000` (sin decimales en la UI), fechas `DD/MM/YYYY`,
timezone `America/Argentina/Buenos_Aires`. Los timestamps se guardan en UTC
(`timestamptz`) y se formatean a hora local sólo en el borde de UI —
`lib/format.ts` es el único lugar que debería tener esta lógica.
