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

Resueltos:

1. ~~No existe un proyecto Supabase real.~~ **Resuelto**: proyecto
   `mgpybpbkjosxzaptlwnm` (región `sa-east-1`) creado y en uso. La
   migration de Fase 1 se aplicó vía **SQL Editor del dashboard**, no vía
   `supabase db push`: la conexión directa (`db.<ref>.supabase.co:5432`)
   no es alcanzable desde esta red (sólo tiene registro IPv6, la conexión
   residencial no lo enruta), y el connection pooler
   (`aws-0-sa-east-1.pooler.supabase.com:5432`, usuario
   `postgres.<project-ref>`) requiere la contraseña de la base — usarlo
   para pushes futuros desde esta máquina si el CLI hace falta, sabiendo
   que el SQL Editor sigue siendo el camino de respaldo. Como el CLI nunca
   registró este push, `supabase_migrations.schema_migrations` no tiene
   esta versión marcada — si en algún momento se usa `supabase db push`
   desde el CLI, correr antes `supabase migration repair --status applied
   20260908215501` (con el mismo `--db-url` del pooler) para que no
   intente reaplicar una migration que ya existe.
2. ~~Alta inicial del usuario owner.~~ **Resuelto**: usuario creado desde
   el dashboard (Authentication → Users) y su fila en `user_roles` con
   `role = 'owner'` insertada vía SQL Editor. Login verificado de punta a
   punta en local.

Pendientes:

3. **No hay proyecto Vercel conectado.** El deploy a producción/preview
   depende de esto.
4. **Contenido de marca real** (logo, paleta de colores, tipografía) no
   existe todavía en el repo — la UI usa la paleta neutra por defecto de
   shadcn/ui hasta que Juli provea assets (sección 57 del brief).

Ninguno de estos bloquea seguir escribiendo código.

## 8. Modelo de permisos (resumen)

| Rol              | Lectura                          | Escritura                                    |
|------------------|-----------------------------------|-----------------------------------------------|
| `owner`          | Todo                              | Todo, incluida configuración sensible         |
| `operations`     | Pedidos, clientes, stock, producción | Pedidos, clientes, stock, producción       |
| `workshop_staff` | Grupos, alumnos, asistencia       | Asistencia, inscripciones                     |
| `viewer`         | Lectura general (sin finanzas)    | Ninguna                                       |
| anónimo          | Catálogo mayorista público (Fase 5); workshop publicado + cupo + alias de pago (Fase 9.5) | Crear una solicitud mayorista (Fase 5); crear una inscripción a workshop (Fase 9.5) |

La tabla completa de políticas RLS vive en las migrations mismas
(comentadas); esta tabla es la intención de negocio, no el código fuente de
verdad.

## 9. Brand / Design System

Implementado en la Fase 10, antes de la Fase 2, a pedido explícito: la
plataforma tenía que dejar de sentirse "SaaS genérico" y sentirse
inequívocamente Pottery by Juli desde el día 1 de uso real.

### Fuente de identidad

- Tienda oficial: `potterybyjuliceramica.mitiendanube.com` (tema Morelia de
  Tiendanube).
- Logo oficial, descargado y versionado localmente en
  [`public/brand/pottery-logo.png`](../public/brand/pottery-logo.png) (PNG
  2000×2000, fondo transparente, sin redibujar/recolorear/vectorizar). El
  asset original vivía en el CDN de Tiendanube — nunca se hotlinkea en
  producción.
- La paleta fue relevada del logo y de la marca (no inferida de fotos del
  hero, que tienen verdes de bosque saturados que no pertenecen al sistema
  — sección 40 del brief de diseño).

### Tokens de marca

Fuente única de verdad en [`app/globals.css`](../app/globals.css), bloque
`:root` "Pottery Brand Tokens". Cada color se define **una sola vez** como
oklch (para calzar con la arquitectura Tailwind v4/shadcn ya existente,
enteramente en oklch) y todos los tokens semánticos (`--primary`,
`--background`, etc.) son alias `var(--pottery-*)` — cambiar un color de
marca es una edición en un solo lugar.

| Token              | Hex        | Uso principal                                    |
|--------------------|------------|---------------------------------------------------|
| `--pottery-ink`    | `#273128`  | Texto principal, headings — `--foreground`         |
| `--pottery-sage`   | `#687866`  | **Primary**: botones, links, focus, nav activa      |
| `--pottery-sage-light` | `#7D8D78` | Iconos/decorativo — falla AA como texto chico       |
| `--pottery-sage-soft`  | `#E7ECE5` | Ítem activo del sidebar, superficies seleccionadas |
| `--pottery-ivory`  | `#F7F4ED`  | **Background** general de toda la app               |
| `--pottery-sand`   | `#EEE9DE`  | `--muted`, paneles secundarios                      |
| `--pottery-stone`  | `#D8D5CC`  | `--border`/`--input`                                |
| `--pottery-muted`  | `#687068`  | `--muted-foreground` (texto secundario)             |
| `--pottery-white`  | `#FFFFFF`  | `--card`/`--popover` (superficies elevadas)          |
| `--pottery-clay`   | `#A8795D`  | Acento auxiliar (charts/categorías) — nunca primary |

Hex → oklch calculado matemáticamente (conversión sRGB→OKLab→OKLCH
estándar); el valor visual reproduce el hex exacto, no es una aproximación
a ojo. `--destructive` se mantiene **fuera** de la marca deliberadamente —
sigue siendo el rojo semántico de shadcn: un pedido cancelado tiene que
leerse como destructivo pase lo que pase con la paleta.

Mapeo semántico completo en `:root`: `background`→ivory, `foreground`→ink,
`card`/`popover`→white, `primary`→sage (`primary-foreground`→white),
`secondary`/`accent`→sage-soft (`-foreground`→ink), `muted`→sand
(`muted-foreground`→pottery-muted), `border`/`input`→stone, `ring`→sage.
Los tokens `--sidebar-*` usan el mismo mapeo (sidebar blanco, borde stone,
ítem activo sage-soft/ink, ícono activo sage).

**Contraste verificado (WCAG)**: primary sobre blanco 4.70:1, texto
principal sobre ivory 12.28:1, texto muted sobre ivory 4.66:1 — los tres
pasan AA para texto normal. `sage-light` (3.53:1) y `clay` (3.78:1) NO
pasan AA como texto chico — por diseño sólo se usan como accent/ícono/chart
(cumplen el mínimo de 3:1 para elementos no textuales), nunca como color de
texto de cuerpo. El hover del botón primary usa una variante de sage ~6L
más oscura (`--pottery-sage-hover`) en vez de opacidad — bajar la opacidad
sobre un fondo claro aclara el botón en vez de oscurecerlo.

`--radius` es `0.75rem` (antes `0.625rem`) — moderadamente orgánico, sin
llegar a pill-shaped.

Dark mode (`.dark`) se dejó intacto sin invertir tiempo en re-diseñarlo:
hoy es inalcanzable en la práctica (nada agrega la clase `.dark`, no hay
toggle ni media query wireados), así que no hay riesgo de que un usuario
lo vea a medio adaptar.

### Dónde vive cada pieza

- Logo: `public/brand/pottery-logo.png`, mostrado con `next/image` en
  `app/(auth)/layout.tsx` (login, ~176px), `app/(app)/layout.tsx` (sidebar
  desktop ~96px + header mobile ~44px) y `app/mayorista/layout.tsx`
  (~48px). Siempre con `object-fit: contain`, nunca deformado.
- Favicon: `app/icon.tsx` (generado con `next/og`) — un cuadrado sage con
  una "P" blanca. El logo completo tiene demasiado detalle para 16–32px;
  esto es explícitamente temporal y **no** un isotipo inventado, sólo el
  color de marca + tipografía. Pendiente: reemplazar cuando exista un
  favicon oficial optimizado.
- `components/ui/button.tsx`: única modificación puntual fuera de
  `globals.css` — el hover del variant `default` usa
  `--pottery-sage-hover` en vez de `/80` opacity.

### Backoffice vs. portal mayorista

Comparten exactamente los mismos tokens — nunca una paleta paralela. La
diferencia es de composición, no de color: el backoffice prioriza
densidad/velocidad de operación (tablas, forms compactos); el portal
mayorista (Fase 5, `app/mayorista/`) prioriza fotografía de producto y
espacio, más cerca del lenguaje visual de la tienda Tiendanube. Como todo
el código ya usaba tokens semánticos (`bg-primary`, `border`, `bg-muted`...)
y no colores hardcodeados, este cambio de paleta se propagó a las ~25
rutas existentes sin tocar página por página — confirmado por auditoría
(`grep` de hex/colores Tailwind fuera de marca en `app/` y `components/`:
cero resultados fuera de `components/ui/` y `app/icon.tsx`).

## 10. Calendario y portal público de workshops (Fase 9.5)

### Calendario: agregador, no fuente nueva

`/calendario` (`app/(app)/calendario/`) no persiste eventos propios para
clases ni workshops — es una vista de lectura que combina tres orígenes en
`lib/calendar.ts`:

- **Clases recurrentes**: `getWeeklyClasses()` lee `workshop_groups` donde
  `weekday`/`start_time` están seteados (agregados en esta fase) y
  `archived_at is null`. No se materializa una fila por cada semana futura
  — el "martes 16hs" de un grupo es siempre el mismo dato, consultado con
  el filtro de la semana pedida.
- **Workshops/ferias puntuales**: `getWorkshopsInRange(start, end)` lee
  `events` por `event_date` dentro del rango visible.
- **Fechas especiales**: `getSpecialDatesInRange(start, end)` lee la
  tabla nueva `special_dates`; si `recurs_yearly = true`, la ocurrencia se
  calcula comparando mes/día contra cada año que el rango visible toca (no
  se duplica una fila por año).

`special_dates` es la única entidad realmente nueva de esta fase — se creó
porque "Día de la Madre" no es una clase, ni un workshop, ni tiene cupo ni
inscriptos; forzarla dentro de `events` habría ensuciado ese modelo con
campos siempre nulos. Explícitamente **no** se usa para talleres/workshops.

La semana es la vista por defecto (lunes a domingo, `lib/calendar.ts:
startOfWeek`); se descartó una vista de mes por ahora (no aporta densidad
de información extra sobre lo que Juli realmente necesita día a día — ver
`docs/roadmap.md`). Cada entrada se distingue visualmente por tipo
(clase/workshop/fecha especial) reusando los tokens de marca — sin colores
nuevos — y se filtra en el cliente con querystring (`?filter=`), sin
round-trip al servidor.

### Workshops: de `events` interno a portal público

`events` (ya existente desde una fase anterior para ferias) se extendió
con lo necesario para un flujo público completo: `slug` (único, editable
mientras el workshop no está publicado, generado automáticamente desde el
nombre vía `lib/slug.ts` si no se especifica), `description`, `start_time`/
`end_time`, `address`, `image_path`, `additional_info`,
`payment_account_id` (FK a `payment_accounts` — nunca se duplican datos
bancarios), `is_registration_open`.

`status` pasó de un enum de dos valores a
`draft | published | full | completed | cancelled | archived`. La regla de
negocio central: **`draft` nunca es accesible públicamente**, sin importar
que alguien adivine o comparta el slug — la única puerta de lectura pública
es `workshop_public_view`, que filtra `where status = 'published'`. Publicar
pasa por la Server Action `publishEvent()` en vez del setter genérico de
estado, porque valida que el slug exista antes de permitir la transición
(un workshop sin slug no puede tener link público).

### Cómo llega un anónimo a datos sin exponer lo interno

El patrón ya usado en el portal mayorista (Fase 5) se reutiliza acá: en vez
de policies RLS directas sobre `events`/`payment_accounts` para el rol
`anon`, se crearon vistas que corren en contexto del dueño
(`with (security_invoker = false)`) y sólo seleccionan columnas
explícitamente públicas:

- `workshop_public_view`: datos comerciales del workshop + un
  `confirmed_count` calculado con una subquery agregada dentro de la misma
  vista — así el frontend puede mostrar "3 lugares disponibles" sin que
  `anon` tenga jamás una policy de lectura sobre `event_registrations`
  (ni agregada ni fila por fila).
- `payment_account_public_view`: sólo `id`, `name`, `alias`, `holder_name`,
  `account_type` — nunca saldo, notas ni el resto de la cuenta.
- `location_public_view`: sólo `id`, `name`, `city`, `province`.

La única escritura permitida para `anon` es la RPC `register_for_workshop`
(`security definer`), documentada en detalle en `docs/business-rules.md`
("Cupos y concurrencia"). El frontend público (`app/workshops/[slug]/`)
nunca envía `status`, `payment_status`, `price` ni `capacity` — sólo datos
de contacto; todo lo demás lo decide la función en el servidor.

### Layout público separado

`app/workshops/` es un árbol de rutas independiente de `app/(app)/`
(backoffice) y de `app/mayorista/` (mismo patrón que Fase 5): su propio
`layout.tsx` sin sidebar ni navegación interna, agregado a
`PUBLIC_PATHS` en `lib/supabase/middleware.ts` para que el middleware de
auth no lo intercepte. Visualmente reusa los mismos tokens de marca que el
resto de la app pero con una composición más comercial (foto grande,
menos densidad) — mismo criterio ya establecido para `app/mayorista/`.

### WhatsApp: un único punto de verdad

`lib/customers-shared.ts` expone `whatsappLink(rawPhone, message?)` —
normaliza el número (agrega el código de país argentino si falta) y arma
el link `wa.me`. Todo botón de WhatsApp agregado en esta fase (inscriptos
de un evento, alumnos de un taller, ficha de cliente) llama a esta misma
función sobre el `whatsapp` del `customer` relacionado — nunca se
introduce un campo de teléfono duplicado en otra tabla.
