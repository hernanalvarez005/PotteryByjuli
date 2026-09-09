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
import { NewExpenseDialog } from "./new-expense-dialog";

export default async function GastosPage() {
  const user = await requireUser();
  const canEdit = isOwner(user) || hasRole(user, "operations");

  if (!canEdit) {
    return (
      <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        No tenés permiso para ver gastos.
      </p>
    );
  }

  const supabase = await createClient();
  const [
    { data: expenses },
    { data: categories },
    { data: methods },
    { data: accounts },
    { data: businessUnits },
  ] = await Promise.all([
    supabase
      .from("expenses")
      .select("id,expense_date,concept,vendor,amount,expense_categories(name),payment_methods(name),business_units(name)")
      .order("expense_date", { ascending: false })
      .limit(200),
    supabase.from("expense_categories").select("id,name").eq("is_active", true).order("sort_order"),
    supabase.from("payment_methods").select("id,name").eq("is_active", true).order("sort_order"),
    supabase.from("payment_accounts").select("id,name").eq("is_active", true).order("code"),
    supabase.from("business_units").select("id,name").eq("is_active", true).order("sort_order"),
  ]);

  const rows = expenses ?? [];
  const total = rows.reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Gastos</h1>
          <p className="text-muted-foreground">Costos de operar Pottery, por categoría y unidad.</p>
        </div>
        <NewExpenseDialog
          categories={categories ?? []}
          methods={methods ?? []}
          accounts={accounts ?? []}
          businessUnits={businessUnits ?? []}
        />
      </div>

      <Card className="w-fit">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">
            Total (últimos {rows.length} gastos)
          </CardTitle>
        </CardHeader>
        <CardContent className="text-2xl font-semibold">{formatCurrency(total)}</CardContent>
      </Card>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Todavía no cargaste ningún gasto.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Concepto</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead>Unidad</TableHead>
              <TableHead>Importe</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="text-muted-foreground">{formatDate(e.expense_date)}</TableCell>
                <TableCell>
                  {e.concept}
                  {e.vendor && <span className="ml-2 text-xs text-muted-foreground">{e.vendor}</span>}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {(e.expense_categories as unknown as { name: string } | null)?.name ?? "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {(e.business_units as unknown as { name: string } | null)?.name ?? "—"}
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
