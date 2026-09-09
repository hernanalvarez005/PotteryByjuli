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
import { NewCampaignDialog } from "./new-campaign-dialog";

export default async function CampanasPage() {
  const user = await requireUser();
  const canEdit = isOwner(user) || hasRole(user, "operations");

  if (!canEdit) {
    return (
      <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        No tenés permiso para ver campañas.
      </p>
    );
  }

  const supabase = await createClient();
  const [{ data: campaigns }, { data: orders }] = await Promise.all([
    supabase.from("campaigns").select("*").order("start_date", { ascending: false }),
    supabase.from("orders").select("campaign_id,total").not("campaign_id", "is", null),
  ]);

  const salesByCampaign = new Map<string, number>();
  for (const o of orders ?? []) {
    if (!o.campaign_id) continue;
    salesByCampaign.set(o.campaign_id, (salesByCampaign.get(o.campaign_id) ?? 0) + o.total);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campañas</h1>
          <p className="text-muted-foreground">
            Día de la Madre, Navidad, y cualquier otra campaña comercial.
          </p>
        </div>
        <NewCampaignDialog />
      </div>

      {(campaigns ?? []).length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Todavía no cargaste ninguna campaña.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Período</TableHead>
              <TableHead>Inversión</TableHead>
              <TableHead>Ventas asociadas</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(campaigns ?? []).map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {c.start_date ? formatDate(c.start_date) : "—"}
                  {c.end_date ? ` – ${formatDate(c.end_date)}` : ""}
                </TableCell>
                <TableCell>{c.investment != null ? formatCurrency(c.investment) : "—"}</TableCell>
                <TableCell>{formatCurrency(salesByCampaign.get(c.id) ?? 0)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
