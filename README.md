# Pottery — Sistema operativo

Plataforma operativa central de Pottery (cerámica artesanal, La Plata /
Tres Lomas): pedidos, clientes, catálogo, precios, stock, producción,
talleres, workshops, ferias, pagos, gastos y reportes — con un catálogo
mayorista público transaccional como diferencial comercial.

Ver `docs/` para el modelo completo:

- [`docs/architecture.md`](docs/architecture.md) — stack, estructura,
  decisiones técnicas, riesgos abiertos.
- [`docs/database.md`](docs/database.md) — modelo de datos, tabla por
  tabla, con el porqué de cada una.
- [`docs/business-rules.md`](docs/business-rules.md) — reglas de negocio
  que el código debe respetar aunque no sean obvias leyéndolo.
- [`docs/roadmap.md`](docs/roadmap.md) — fases, qué está hecho y qué falta.
- [`docs/testing.md`](docs/testing.md) — estrategia de tests.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 ·
shadcn/ui (sobre Base UI) · Supabase (Postgres, Auth, Storage, RLS) · Zod.

## Setup local

```bash
npm install
cp .env.example .env.local   # completar con las credenciales del proyecto Supabase
npm run dev
```

Sin un proyecto Supabase real conectado, el login y cualquier pantalla que
consulte datos no van a funcionar — ver
[`docs/architecture.md`](docs/architecture.md#7-riesgos-abiertos--bloqueadores-de-negocio).

### Base de datos

Todo cambio de esquema vive versionado en `supabase/migrations/`. Nunca se
aplican cambios manuales a producción que no queden como una migration.

```bash
export SUPABASE_PROJECT_REF=xxxxxxxxxxxx   # desde el dashboard de Supabase
npm run db:link    # una sola vez, para apuntar el CLI a ese proyecto
npm run db:push    # aplica las migrations pendientes
npm run db:types   # regenera types/database.types.ts desde el esquema real
```

## Checks antes de cualquier commit

```bash
npm run typecheck
npm run lint
npm run build
```
