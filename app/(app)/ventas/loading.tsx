import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const COLUMNS = ["Código", "Cliente", "Unidad", "Total", "Saldo", "Fecha"];

/** loading.tsx (perf audit H-11A) — ver dashboard/loading.tsx. */
export default function VentasLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Skeleton className="h-8 w-24" />
          <Skeleton className="mt-2 h-5 w-72" />
        </div>
        <Skeleton className="h-8 w-44" />
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
