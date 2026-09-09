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
  de WhatsApp (agrega `54` cuando falta, no lo duplica cuando ya está).

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
6. **Workshop**: registrar persona → cobrar → ocupa un cupo (y no permite
   pasarse del cupo total).
