import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { getCustomers, customerDisplayName, whatsappLink } from "@/lib/customers";
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

export default async function ClientesPage() {
  const user = await requireUser();
  const canEdit = isOwner(user) || hasRole(user, "operations");
  const customers = await getCustomers();

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

      {customers.length === 0 ? (
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
            {customers.map((c) => (
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
