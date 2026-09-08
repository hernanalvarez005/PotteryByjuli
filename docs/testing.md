# Testing — Pottery

Ningún framework de test está instalado todavía (Fase 1 no tiene lógica de
negocio no trivial que lo justifique — `configuracion/actions.ts` es CRUD
simple validado por zod). Se agrega en la fase donde aparece la primera
regla de negocio real que vale la pena proteger: **Fase 3 (totales de
pedido) y sobre todo Fase 5 (reglas mayoristas)**.

## Qué se va a usar

- **Unit / integration**: Vitest. Se prefiere sobre Jest por arrancar más
  rápido con Turbopack/ESM y no necesitar configuración adicional de
  transform para TypeScript.
- **E2E**: Playwright.

Ninguno de los dos se instala preventivamente — se agrega en el commit que
trae el primer test real, para no cargar dependencias sin uso.

## Checks obligatorios antes de cerrar cualquier fase

```bash
npm run typecheck
npm run lint
npm run build
```

(`npm test` se suma a esta lista en cuanto exista al menos un test.) Nunca
se ignoran errores de TypeScript ni se desactiva ESLint para destrabar un
commit.

## Casos que sí o sí necesitan test cuando se implementen

Prioridad por impacto de un bug silencioso:

1. **Mínimos y validación del carrito mayorista** (Fase 5): monto mínimo,
   mínimo por producto, múltiplos, mensaje de "cuánto falta". Es la lógica
   con más superficie de error de negocio de todo el proyecto.
2. **Cálculo de totales/saldo de un pedido** (Fase 3): subtotal, descuentos,
   pagado, saldo — con snapshots de precio, no con el precio actual del
   catálogo.
3. **Movimientos de stock y transferencias** (Fase 4): que una
   transferencia entre ubicaciones sea atómica (todo o nada), y que
   disponible = físico − reservado nunca dé negativo sin que el sistema lo
   marque.
4. **Cierre de una orden de producción** (Fase 6): que el ingreso a stock
   sea exactamente la cantidad correcta declarada, y que la merma quede
   registrada, nunca descartada silenciosamente.
5. **Cupos de eventos/talleres** (Fases 7-8): que no se pueda sobrevender
   un cupo por una condición de carrera entre dos inscripciones
   simultáneas.

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
