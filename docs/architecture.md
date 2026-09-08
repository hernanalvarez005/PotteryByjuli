# Arquitectura — Pottery

## 0. Contexto y auditoría inicial

Este proyecto arrancó **desde cero**: no existía código, ni repo, ni proyecto
Supabase. Lo único preexistente eran documentos de marketing en
`~/Downloads` (campañas, estrategia de contenido, análisis de competencia),
sin relación con el modelo de datos. No hay datos reales de clientes ni
producción en ningún lado — por lo tanto no aplica ninguna restricción de
"no tocar datos productivos" todavía. Cuando eso cambie (ver sección 93 del
brief original), las migrations dejan de poder asumir que las tablas están
vacías.

Repositorio: [hernanalvarez005/PotteryByjuli](https://github.com/hernanalvarez005/PotteryByjuli).
Código local en `~/Developer/PotteryByjuli`.

## 1. Stack

- **Next.js 16 (App Router) + React 19 + TypeScript**, Turbopack.
- **Tailwind CSS v4** + **shadcn/ui**. Importante: la versión de shadcn/ui
  instalada al momento de crear este proyecto usa **Base UI** como motor de
  primitivos (no Radix). Esto sólo importa para quien escriba componentes
  compuestos: en vez de `asChild` se usa la prop `render={<Elemento />}`.
- **Zod** para validación compartida cliente/servidor (`schemas/`).
- **lucide-react** para iconografía.
- **Supabase**: Postgres, Auth, Storage, RLS, RPC/funciones cuando haga
  falta atomicidad. CLI de Supabase instalado como devDependency (`npx
  supabase ...`) en vez de un binario global, para no depender del entorno
  de la máquina.
- **Vercel** para deploy (pendiente de conectar — ver Riesgos).

No se agregó ninguna librería de fetching/estado (React Query, Zustand,
etc.) todavía: con Server Components + Server Actions alcanza para las
fases actuales. Se reevalúa si aparece una necesidad concreta de estado
cliente complejo (p. ej. el carrito mayorista en Fase 5, que si accede a
`localStorage` es candidato natural a una librería liviana, no antes).

## 2. Principio de núcleo compartido

Una sola fuente de verdad por concepto de negocio, reutilizada por todas las
unidades de negocio (minorista, mayorista, personalizados, talleres,
workshops, ferias):

```
CLIENTE → PEDIDO → PRODUCTO/SERVICIO → PRODUCCIÓN → STOCK → ENTREGA → PAGO → RESULTADO
```

Ver `docs/database.md` para el modelo concreto y `docs/business-rules.md`
para cuándo SÍ conviene una entidad separada (regla de la sección 83/93 del
brief: extender el núcleo por defecto; una entidad nueva sólo si su
naturaleza operacional es realmente distinta — inscripción a taller/evento
sí, "pedido mayorista" no).

## 3. Estructura de carpetas

```
app/
  (auth)/login/          — páginas públicas de autenticación
  (app)/                 — backoffice protegido (requiere sesión)
    dashboard/
    configuracion/
  page.tsx               — redirect a /dashboard
components/
  ui/                     — primitivos shadcn/ui (no tocar a mano salvo necesidad)
  sidebar-nav.tsx, user-menu.tsx — layout del backoffice
lib/
  supabase/               — clientes (browser/server) + refresco de sesión
  auth.ts                 — usuario actual + roles (server-only)
  catalog.ts              — registro de catálogos configurables
  nav.ts                  — navegación del backoffice + fase que la habilita
  format.ts               — moneda/fecha en formato AR
schemas/                  — zod: una fuente de validación, front y back
types/database.types.ts   — tipos generados por Supabase (placeholder hasta linkear)
supabase/
  migrations/             — única forma de cambiar el esquema (versionado)
  config.toml
docs/                      — este set de documentos
```

`features/` está reservado para cuando un módulo (pedidos, stock,
producción, etc.) crezca lo suficiente como para necesitar sus propios
componentes/acciones agrupados — no se crea vacío de antemano.

## 4. Autenticación y roles

- Supabase Auth, flujo SSR con `@supabase/ssr` (`lib/supabase/{client,server}.ts`).
- `proxy.ts` (convención Next.js 16 — reemplaza a `middleware.ts`, deprecado)
  refresca la sesión en cada request y redirige a `/login` si no hay usuario,
  salvo en rutas explícitamente públicas (login, y `/mayorista` desde la
  Fase 5).
- Roles: `owner | operations | workshop_staff | viewer`, en un enum
  Postgres (`app_role`) — es un conjunto fijo y pequeño que sólo cambia con
  una migration, no un catálogo que Juli edite (ver `docs/database.md`).
- Un usuario puede tener más de un rol (`user_roles` es N:M vía PK
  compuesta).
- **Nunca** se confía en ocultar un botón como mecanismo de seguridad: cada
  verificación de rol existe en servidor (Server Actions, `lib/auth.ts`) y
  además en RLS. La UI sólo oculta para no confundir.
- No se usa la Service Role Key desde el navegador bajo ninguna
  circunstancia; hoy no hay ningún camino de código que la importe.

## 5. Multi-tenant / multi-ubicación

No es multi-tenant (una sola organización: Pottery). Sí es multi-ubicación
(`locations`: La Plata, Tres Lomas, + futuras). El stock, las ventas y las
ferias se filtran por ubicación, no por tenant.

## 6. Decisiones técnicas puntuales (Fase 1)

- **`profiles`** se crea automáticamente al registrarse un usuario (trigger
  `on_auth_user_created`), para no tener que sincronizarlo a mano.
- **RLS con función `SECURITY DEFINER`** (`has_role`, `is_owner`): evita la
  recursión infinita típica de escribir una policy sobre `user_roles` que
  vuelve a consultar `user_roles`.
- **Catálogos de configuración** (`business_units`, `locations`,
  `sales_channels`, `payment_methods`, `payment_accounts`) son tablas, no
  enums: Juli los edita desde `/configuracion` sin necesitar una migration
  cada vez que agrega, por ejemplo, un canal de venta nuevo.
- **`settings`** (key/value jsonb) queda como escape hatch genérico para
  configuración que todavía no amerita su propia tabla. Si un área de
  configuración crece (como las reglas mayoristas en Fase 5), migra a una
  tabla dedicada — ver `wholesale_settings` en el modelo de datos.
- **Sin generar `types/database.types.ts` todavía**: no hay proyecto
  Supabase real linkeado, así que los clientes de Supabase no están
  parametrizados con `Database` (evita falsos "never" de TypeScript sobre
  un tipo placeholder). Correr `npm run db:types` en cuanto exista un
  proyecto reemplaza esto por tipos reales — a partir de ahí sí conviene
  parametrizar `createClient()`.

## 7. Riesgos abiertos / bloqueadores de negocio

Estas son decisiones que **no puedo inferir** y bloquean el resto de las
fases si no se resuelven:

1. **No existe un proyecto Supabase real.** Sin él no hay forma de: correr
   las migrations, generar tipos, probar login de verdad, ni desplegar
   nada funcional. Es la dependencia #1 para cerrar la Fase 1.
2. **No hay proyecto Vercel conectado.** El deploy a producción/preview
   depende de esto.
3. **Alta inicial del usuario owner (Juli).** Supabase Auth no tiene "el
   primer usuario es admin" automático: hay que crear su usuario (por
   invitación desde el dashboard de Supabase, o `signUp` una vez) y luego
   insertarle una fila en `user_roles` con `role = 'owner'` a mano (una
   sola vez, documentado, no es un script recurrente).
4. **Contenido de marca real** (logo, paleta de colores, tipografía) no
   existe todavía en el repo — la UI usa la paleta neutra por defecto de
   shadcn/ui hasta que Juli provea assets (sección 57 del brief).

Ninguno de estos bloquea seguir escribiendo código (Fases 2 en adelante
pueden avanzar contra un esquema versionado en migrations sin una base
Supabase activa), pero si bloquean *probar* el sistema de punta a punta.

## 8. Modelo de permisos (resumen)

| Rol              | Lectura                          | Escritura                                    |
|------------------|-----------------------------------|-----------------------------------------------|
| `owner`          | Todo                              | Todo, incluida configuración sensible         |
| `operations`     | Pedidos, clientes, stock, producción | Pedidos, clientes, stock, producción       |
| `workshop_staff` | Grupos, alumnos, asistencia       | Asistencia, inscripciones                     |
| `viewer`         | Lectura general (sin finanzas)    | Ninguna                                       |
| anónimo          | Catálogo mayorista público (Fase 5) | Crear una solicitud mayorista (Fase 5)      |

La tabla completa de políticas RLS vive en las migrations mismas
(comentadas); esta tabla es la intención de negocio, no el código fuente de
verdad.
