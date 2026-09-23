import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Sólo las columnas que se ven para cualquier rol — la de selección y
// "Acciones" dependen de canEdit, que loading.tsx no puede resolver sin
// fetchear (eso es justo lo que H-11A evita tocar).
const COLUMNS = ["Producto", "Categoría", "Precio minorista", "Precio mayorista", "Estado"];

/** loading.tsx (perf audit H-11A) — ver dashboard/loading.tsx. */
export default function ProductosLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Skeleton className="h-8 w-32" />
          <Skeleton className="mt-2 h-5 w-96" />
        </div>
        <Skeleton className="h-8 w-36" />
      </div>

      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-14 rounded-full" />
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
