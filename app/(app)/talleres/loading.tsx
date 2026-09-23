import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** loading.tsx (perf audit H-11A) — ver dashboard/loading.tsx. 6 tarjetas
 * fijas sólo para el esqueleto — no reflejan la cantidad real de grupos. */
export default function TalleresLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Skeleton className="h-8 w-28" />
          <Skeleton className="mt-2 h-5 w-64" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-28" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <CardTitle className="text-base">
                <Skeleton className="h-4 w-32" />
              </CardTitle>
              <Skeleton className="h-3.5 w-24" />
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-5 w-24 rounded-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
