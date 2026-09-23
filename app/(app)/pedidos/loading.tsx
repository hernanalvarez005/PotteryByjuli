import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const COLUMNS = ["Código", "Cliente", "Unidad", "Estado", "Total", "Saldo", "Fecha"];

/** loading.tsx (perf audit H-11A) — ver dashboard/loading.tsx. Filas
 * fijas (6) sólo para el esqueleto — no reflejan la cantidad real de
 * pedidos, que varía por filtro. */
export default function PedidosLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Skeleton className="h-8 w-32" />
          <Skeleton className="mt-2 h-5 w-96" />
        </div>
        <Skeleton className="h-8 w-32" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-md border p-1">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            {COLUMNS.map((c) => (
              <TableHead key={c}>{c}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 6 }).map((_, i) => (
            <TableRow key={i}>
              {COLUMNS.map((c) => (
                <TableCell key={c}>
                  <Skeleton className="h-4 w-full max-w-24" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
