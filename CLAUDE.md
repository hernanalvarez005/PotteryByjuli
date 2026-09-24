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
- Tests (estándar del repo, detalle en `docs/testing.md`):
  - `npm test` → unit (sin base ni variables de entorno).
  - `npm run test:integration` → integración contra **Supabase local**,
    obligatoria cuando el cambio toca SQL/RPC o lógica que vive en Postgres.
  - `npm run test:all` → gate completo (unit + integración).
  - La integración **falla** (no se saltea) si faltan
    `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` /
    `SUPABASE_SERVICE_ROLE_KEY`, si la URL no es local o si Supabase no
    responde. Nunca cargar el `.env.local` de producción para tests.
  - Cada suite de integración limpia lo que crea con `cleanupFixtures()`
    (`tests/support/fixture-cleanup.ts`) desde `afterAll`: IDs exactos,
    nunca por patrón, y sin `.in()` gigantes.
