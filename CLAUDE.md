@AGENTS.md

# Pottery

Antes de tocar código, leé `docs/architecture.md`, `docs/database.md`,
`docs/business-rules.md` y `docs/roadmap.md` — ahí están las decisiones de
producto y arquitectura que no se pueden re-derivar del código solo.

Reglas rápidas de este repo:

- Toda unidad de negocio (minorista, mayorista, personalizados, talleres,
  workshops, ferias) comparte el mismo núcleo de datos
  (`customers`/`orders`/`products`/stock). No crear tablas ni módulos
  paralelos por unidad de negocio salvo que su naturaleza operacional sea
  realmente distinta (ver `docs/business-rules.md`).
- Todo cambio de esquema de Supabase es una migration en
  `supabase/migrations/`, nunca un `ALTER` manual.
- shadcn/ui en este proyecto corre sobre **Base UI**, no Radix: usar
  `render={<Componente />}` en vez de `asChild`.
- Antes de cerrar cualquier cambio: `npm run typecheck && npm run lint &&
  npm run build`.
