import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** loading.tsx (perf audit H-11A) — sólo percepción de navegación,
 * nunca cambia fetching ni lógica: Next la muestra automáticamente
 * mientras page.tsx espera sus datos, dentro del mismo layout ya
 * renderizado (sidebar/header no esperan esto). Reusa Card/CardHeader
 * para que el contenedor real y el esqueleto midan exactamente lo
 * mismo — nada salta de tamaño cuando el contenido real reemplaza al
 * esqueleto. */
export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-2 h-5 w-80" />
      </div>

      <div className="flex gap-2">
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
        {["Período", "Desde", "Hasta", "Unidad de negocio", "Ubicación", "Canal"].map((label) => (
          <div key={label} className="space-y-1">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-8 w-32" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-3 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-7 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <Skeleton className="h-4 w-36" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Skeleton className="h-56 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <Skeleton className="h-4 w-24" />
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            <Skeleton className="size-40 rounded-full" />
          </CardContent>
        </Card>
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                <Skeleton className="h-4 w-40" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Skeleton className="h-56 w-full" />
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <Skeleton className="h-4 w-32" />
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-56" />
        </CardContent>
      </Card>
    </div>
  );
}
