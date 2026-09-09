# Modelo de datos — Pottery

Fuente de verdad real: `supabase/migrations/*.sql`. Este documento es el
mapa de lectura — explica el *por qué* de cada tabla y cómo se relacionan.
Cuando haya conflicto entre este archivo y una migration ya aplicada, gana
la migration; actualizá este documento en el mismo commit que la cambie.

Convención: **UUID** como PK interna en todas las tablas; los códigos
legibles (`PED-000123`, `MAY-000045`) se generan en la capa de aplicación
recién cuando exista `orders` (Fase 3) — no hace falta antes.

## Fase 1 — implementado

### Roles y perfiles

- **`profiles`** (`id` = `auth.users.id`): nombre, email, avatar, activo.
  Se crea sola vía trigger `handle_new_user` al registrarse un usuario.
- **`app_role`** (enum): `owner | operations | workshop_staff | viewer`.
  Enum y no tabla porque es un conjunto fijo, chico, que cambia con código
  (una migration), no algo que Juli edite desde la UI.
- **`user_roles`** (`user_id`, `role`, PK compuesta): un usuario puede tener
  varios roles.
- **`has_role(role)`, `is_owner()`**: funciones `SECURITY DEFINER` para que
  las policies de RLS puedan chequear el rol del usuario actual sin caer en
  recursión sobre `user_roles`.

### Catálogos de configuración compartidos

Todas con `code` (slug estable, usado por código), `name` (lo que ve Juli),
`is_active`, timestamps. Editables desde `/configuracion` sólo por `owner`;
lectura abierta a cualquier usuario autenticado.

- **`business_units`**: minorista, mayorista, personalizados, talleres,
  workshops, ferias. Usada para filtrar dashboards y reportes (sección 44
  del brief), *no* para separar el modelo de pedidos en tablas distintas.
- **`locations`**: La Plata, Tres Lomas (+ futuras: depósito, feria,
  showroom). Campo `location_type` restringido por `check`.
- **`sales_channels`**: Instagram, WhatsApp, Tienda Nube, Presencial,
  Feria, Referido, Otro. **Un solo catálogo, dos roles distintos en
  `orders`**: `origin_channel_id` ("dónde conoció Pottery") y
  `closing_channel_id` ("dónde se cerró la venta") — nunca un campo único
  que mezcle ambos conceptos (regla explícita del brief, sección 3).
- **`payment_methods`**: cómo paga el cliente (efectivo, transferencia,
  Mercado Pago, tarjeta, otro).
- **`payment_accounts`**: dónde queda la plata (caja efectivo, cuenta
  bancaria, Mercado Pago). No confundir con `payment_methods`: un pago en
  efectivo puede terminar depositado en la cuenta bancaria; son ejes
  independientes.
- **`settings`** (key/value jsonb): configuración suelta que todavía no
  amerita tabla propia.

## Fase 2 — implementado

- **`product_categories`**: árbol simple (sin anidamiento profundo salvo
  que aparezca una necesidad real).
- **`products`** / **`product_variants`**: un producto (p. ej. "Taza
  Clásica") tiene N variantes (Crudo, Rosa, Verde). El stock y el SKU
  viven en la variante cuando el producto tiene variantes; si no las
  tiene, la variante "por defecto" ("Único") igual existe — un trigger
  (`create_default_product_variant`) la crea sola al insertar el
  producto, así el invariante "todo producto tiene ≥1 variante" no
  depende de que el código de aplicación se acuerde de respetarlo.
- **`product_images`**: N imágenes por producto (o por variante puntual,
  `variant_id` nullable), en Supabase Storage (`product-images`, bucket
  público — pensado para el catálogo mayorista público de la Fase 5).
- **`price_lists`** / **`price_list_items`**: `retail` y `wholesale`
  sembradas. Precio = `(price_list_id, product_variant_id) → monto`.
  Preparado para sumar listas nuevas (promo, revendedor) sin tocar
  `products`. Escritura sólo `owner` (pricing es audit-sensitive).
- **`customers`**: base única — un minorista, un mayorista y un alumno son
  el mismo tipo de fila, distinguidos por `customer_tags`, nunca por tener
  tablas separadas.
- **`customer_tags`** / **`customer_tag_links`**: minorista, mayorista,
  alumno, workshop, recurrente, potencial mayorista, personalizado, etc.
- **`customer_notes`**: notas internas con autor y fecha.

## Fases siguientes — diseño previsto (a confirmar/ajustar en cada fase)

Se documenta la intención para que cada fase no reinvente relaciones ya
pensadas, pero el detalle columna-por-columna se termina de cerrar recién
al implementar cada una (evita que este documento se desactualice antes de
que exista una sola migration real).

### Fase 3 — Pedidos y pagos (motor central)

- **`orders`**: entidad única para minorista, personalizado y (Fase 5)
  mayorista — no `retail_orders`/`wholesale_orders` separadas. Campos
  clave: `business_unit_id`, `customer_id`, `origin_channel_id`,
  `closing_channel_id`, `location_id`, `status`, `campaign_id` (nullable),
  `external_source`/`external_order_id` (para una futura sync con Tienda
  Nube, sección 62), `human_code` (`PED-000123`).
- **`order_items`**: producto/variante, cantidad, precio **congelado al
  momento del pedido** (nunca recalculado si cambia el precio del
  catálogo — sección 91).
- **`order_item_customizations`**: texto libre, adjuntos, fecha requerida,
  por ítem (pedidos personalizados).
- **`order_status_history`**: cada cambio de estado, quién y cuándo.
- **`order_attachments`**: Supabase Storage (`order-attachments`, bucket
  privado).
- **`payments`**: separado de `orders` — un pedido puede tener seña + N
  pagos parciales + saldo. Nunca se asume `total_pedido == cobrado`
  (sección 42).

### Fase 4 — Stock

- **`inventory_items`**: producto terminado, materia prima o packaging,
  con su unidad de medida.
- **`inventory_movements`**: ledger append-only (compra, ingreso
  producción, venta, reserva, liberación, transferencia, devolución,
  consumo taller/workshop, asignación/retorno feria, merma, ajuste). El
  stock nunca se actualiza por un `UPDATE` directo a un contador — siempre
  es la suma de movimientos, o un contador mantenido *sólo* por un trigger
  que reacciona a esta tabla (a decidir por performance real, no de
  antemano).
- **`inventory_reservations`**: distingue físico vs. reservado vs.
  disponible (sección 23) — evita vender dos veces lo mismo.
- **`stock_thresholds`**: mínimo por variante/ubicación → alertas.
- **`stock_transfers`** / **`stock_transfer_items`**: transferencia entre
  ubicaciones (ej. La Plata → Tres Lomas). Atómica vía función RPC
  (salida + entrada o ninguna de las dos); **no es una venta**.

### Fase 6 — Producción

- **`production_orders`**: código, origen (reposición/venta/mayorista/
  personalizado/workshop/feria), producto/variante, cantidad, prioridad,
  responsable, estado.
- **`production_stage_events`**: historial de etapas (modelado → secado →
  primera cocción → esmaltado → segunda cocción → control → terminado),
  etapas configurables, no todas obligatorias por orden.
- Al cerrar una orden: cantidad correcta impacta `inventory_movements`
  (ingreso), merma/rechazo se registra igual, nunca se oculta.

### Fase 7 — Talleres

- **`workshop_programs`**, **`workshop_groups`** (cupo, horario),
  **`workshop_enrollments`** (vincula `customers`, nunca duplica la
  persona), **`attendance_records`**, **`workshop_dues`** (cuotas:
  período, importe, vencimiento, pagado/pendiente).

### Fase 8 — Eventos (workshops puntuales) y ferias

- **`events`** (workshop o feria), **`event_registrations`** (inscripción
  + pago + cupo — sin sobreventa), **`event_inventory_allocations`**
  (stock asignado a una feria y su devolución).

### Fase 9 — Marketing y finanzas

- **`campaigns`**: nombre, fechas, objetivo, inversión; se asocia a
  `orders.campaign_id`.
- **`expenses`** / **`expense_categories`**: gasto con unidad de negocio y
  evento/campaña opcionales.

### Transversal — auditoría

- **`audit_logs`**: quién, qué, cuándo, valor anterior/nuevo. Prioridad
  alta en: precios, stock, pagos, estado de pedidos, configuración
  mayorista. Se implementa como triggers genéricos sobre esas tablas
  puntuales cuando existan, no como un mecanismo universal desde el día 1.

## Reglas transversales de datos

- **Soft delete, no `DELETE`**, en cualquier tabla con historial
  relacionado (`is_active` / `archived_at`). Un producto con ventas
  históricas se desactiva, nunca se borra.
- **Snapshots de precio/condiciones en el momento del pedido.** Cambiar un
  precio hoy no reescribe pedidos pasados (secciones 11 y 91). Esto aplica
  a `order_items.unit_price`, y en Fase 5 a las condiciones mayoristas
  vigentes al momento de la solicitud.
- **Estados como `check`/enum acotado, nunca string libre.** Dónde exista
  ambigüedad entre "enum" y "tabla configurable", el criterio es: si Juli
  necesita agregar/editar valores sin una migration, es tabla; si el
  significado del valor está escrito en la lógica de la app (p. ej. qué
  hace "confirmado" en el flujo de un pedido), es enum/`check`.
