import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, MessageCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isOwner, hasRole } from "@/lib/auth";
import { customerDisplayName, whatsappLink } from "@/lib/customers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CustomerInfoForm } from "./customer-info-form";
import { TagsPanel } from "./tags-panel";
import { NotesPanel, type Note } from "./notes-panel";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const canEdit = isOwner(user) || hasRole(user, "operations");

  const supabase = await createClient();

  const [{ data: customer }, { data: allTags }, { data: tagLinks }, { data: notes }] =
    await Promise.all([
      supabase.from("customers").select("*").eq("id", id).maybeSingle(),
      supabase.from("customer_tags").select("id,name").order("sort_order"),
      supabase.from("customer_tag_links").select("tag_id").eq("customer_id", id),
      supabase
        .from("customer_notes")
        .select("id,note,created_at,profiles(full_name)")
        .eq("customer_id", id)
        .order("created_at", { ascending: false }),
    ]);

  if (!customer) notFound();

  const formattedNotes: Note[] = (notes ?? []).map((n) => ({
    id: n.id,
    note: n.note,
    created_at: n.created_at,
    author_name:
      (n.profiles as unknown as { full_name: string | null } | null)?.full_name ?? null,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/clientes"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Clientes
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {customerDisplayName(customer)}
          </h1>
          {customer.whatsapp && (
            <a
              href={whatsappLink(customer.whatsapp)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <MessageCircle className="size-4" />
              WhatsApp
            </a>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <CustomerInfoForm customerId={customer.id} customer={customer} canEdit={canEdit} />
        <TagsPanel
          customerId={customer.id}
          allTags={allTags ?? []}
          activeTagIds={(tagLinks ?? []).map((t) => t.tag_id)}
          canEdit={canEdit}
        />
        <NotesPanel customerId={customer.id} notes={formattedNotes} canEdit={canEdit} />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pedidos, pagos y talleres</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Todavía no existen esos módulos (llegan en las próximas fases —
            ver <code className="rounded bg-muted px-1 py-0.5">docs/roadmap.md</code>).
            Cuando estén, el historial completo de esta persona va a
            aparecer acá mismo.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
