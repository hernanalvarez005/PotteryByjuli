import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { getCustomers, customerDisplayName, whatsappLink } from "@/lib/customers";
import { getStudentRoster } from "@/lib/students";
import { formatCurrency } from "@/lib/format";
import { DUE_STATUS_LABELS, formatPeriodLabel, currentPeriod, type DueDisplayStatus } from "@/lib/workshop-dues";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { NewCustomerDialog } from "./new-customer-dialog";
import { CustomerSearchBar } from "./customer-search-bar";

const SEGMENTS = [
  { value: "all", label: "Todos" },
  { value: "students", label: "Alumnas" },
  { value: "wholesale", label: "Mayoristas" },
];

const STATUS_BADGE_VARIANT: Record<DueDisplayStatus | "no_due", "secondary" | "outline" | "destructive"> = {
  paid: "secondary",
  partial: "outline",
  pending: "outline",
  cancelled: "destructive",
  no_due: "outline",
};

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ segment?: string; q?: string }>;
}) {
  const user = await requireUser();
  const canEdit = isOwner(user) || hasRole(user, "operations");
  const { segment = "all", q = "" } = await searchParams;

  const customers = await getCustomers(q);
  const filteredCustomers =
    segment === "wholesale"
      ? customers.filter((c) => c.customer_tag_links.some((l) => l.customer_tags.code === "wholesale"))
      : customers;

  const period = currentPeriod();
  // El roster de alumnas viene de una query enrollment-first (no
  // customer-first) — filtrar server-side necesitaría un `.ilike()`
  // anidado sobre el embed de customers. Dado que el universo de
  // inscripciones activas es chico (nunca "el listado puede crecer" sin
  // límite como el de clientes en general), se filtra acá en memoria
  // después de traerlo — sigue combinándose con ?segment=students igual.
  const fullRoster = segment === "students" ? await getStudentRoster(period) : [];
  const roster = q.trim()
    ? fullRoster.filter((r) => r.customerName.toLowerCase().includes(q.trim().toLowerCase()))
    : fullRoster;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clientes</h1>
          <p className="text-muted-foreground">
            Una sola ficha por persona, sin importar si compró, hizo un
            taller o es mayorista.
          </p>
        </div>
        {canEdit && <NewCustomerDialog />}
      </div>

      <div className="flex flex-wrap gap-1">
        {SEGMENTS.map((s) => {
          const params = new URLSearchParams();
          if (s.value !== "all") params.set("segment", s.value);
          if (q.trim()) params.set("q", q.trim());
          const href = params.toString() ? `/clientes?${params.toString()}` : "/clientes";
          return (
            <Link key={s.value} href={href}>
              <Badge variant={segment === s.value ? "secondary" : "outline"} className="cursor-pointer">
                {s.label}
              </Badge>
            </Link>
          );
        })}
      </div>

      <CustomerSearchBar defaultValue={q} />

      {segment === "students" ? (
        roster.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Todavía no hay alumnas con inscripción activa.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Mes actual: {formatPeriodLabel(period)}</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Clase/grupo</TableHead>
                  <TableHead>WhatsApp</TableHead>
                  <TableHead>Cuota mes actual</TableHead>
                  <TableHead>Último mes pago</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roster.map((r) => (
                  <TableRow key={r.enrollmentId}>
                    <TableCell className="font-medium">{r.customerName}</TableCell>
                    <TableCell className="text-muted-foreground">
                      <Link href={`/talleres/${r.groupId}`} className="hover:underline">
                        {r.groupName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {r.whatsapp ? (
                        <a
                          href={whatsappLink(r.whatsapp)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                        >
                          <MessageCircle className="size-3.5" />
                          {r.whatsapp}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant={STATUS_BADGE_VARIANT[r.currentPeriodStatus]}>
                          {r.currentPeriodStatus === "no_due"
                            ? "Sin cuota generada"
                            : DUE_STATUS_LABELS[r.currentPeriodStatus]}
                        </Badge>
                        {r.currentPeriodBalance != null && r.currentPeriodBalance > 0 && (
                          <span className="text-xs text-muted-foreground">
                            Saldo {formatCurrency(r.currentPeriodBalance)}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.lastPaidPeriod ? formatPeriodLabel(r.lastPaidPeriod) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/clientes/${r.customerId}`} className="text-sm hover:underline">
                        Ver ficha
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )
      ) : filteredCustomers.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Todavía no cargaste ningún cliente.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Contacto</TableHead>
              <TableHead>Ciudad</TableHead>
              <TableHead>Tags</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCustomers.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <Link href={`/clientes/${c.id}`} className="font-medium hover:underline">
                    {customerDisplayName(c)}
                  </Link>
                  {c.company_name && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {c.company_name}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <div className="flex items-center gap-2">
                    {c.whatsapp && (
                      <a
                        href={whatsappLink(c.whatsapp)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        <MessageCircle className="size-3.5" />
                        {c.whatsapp}
                      </a>
                    )}
                    {!c.whatsapp && (c.email ?? "—")}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{c.city ?? "—"}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {c.customer_tag_links.map((link) => (
                      <Badge key={link.customer_tags.id} variant="outline">
                        {link.customer_tags.name}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
