import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NewIncomeDialog } from "./new-income-dialog";

export default async function IngresosPage() {
  const user = await requireUser();
  const canEdit = isOwner(user) || hasRole(user, "operations");

  if (!canEdit) {
    return (
      <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        No tenés permiso para ver ingresos.
      </p>
    );
  }

  const supabase = await createClient();
  const [{ data: entries }, { data: methods }, { data: accounts }, { data: locations }] = await Promise.all([
    supabase
      .from("income_entries")
      .select("id,occurred_at,concept,category,counterparty,amount,payment_methods(name),locations(name)")
      .order("occurred_at", { ascending: false })
      .limit(200),
    supabase.from("payment_methods").select("id,name").eq("is_active", true).order("sort_order"),
    supabase.from("payment_accounts").select("id,name").eq("is_active", true).order("code"),
    supabase.from("locations").select("id,name").eq("is_active", true).order("name"),
  ]);

  const rows = entries ?? [];
  const total = rows.reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Otros ingresos</h1>
          <p className="text-muted-foreground">
            Plata que entra sin ser una venta — alquiler de espacio, comisiones. Lo
            opuesto de Gastos, nunca afecta stock ni productos más vendidos.
          </p>
        </div>
        <NewIncomeDialog methods={methods ?? []} accounts={accounts ?? []} locations={locations ?? []} />
      </div>

      <Card className="w-fit">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">
            Total (últimos {rows.length} ingresos)
          </CardTitle>
        </CardHeader>
        <CardContent className="text-2xl font-semibold">{formatCurrency(total)}</CardContent>
      </Card>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Todavía no cargaste ningún ingreso.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Concepto</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead>Ubicación</TableHead>
              <TableHead>Importe</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="text-muted-foreground">{formatDate(e.occurred_at)}</TableCell>
                <TableCell>
                  {e.concept}
                  {e.counterparty && <span className="ml-2 text-xs text-muted-foreground">{e.counterparty}</span>}
                </TableCell>
                <TableCell className="text-muted-foreground">{e.category ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  {(e.locations as unknown as { name: string } | null)?.name ?? "—"}
                </TableCell>
                <TableCell>{formatCurrency(e.amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
