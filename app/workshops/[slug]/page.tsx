import { notFound } from "next/navigation";
import Image from "next/image";
import type { Metadata } from "next";
import { getPublicWorkshop } from "@/lib/workshops-public";
import { formatCurrency, formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { RegistrationForm } from "./registration-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const workshop = await getPublicWorkshop(slug);
  if (!workshop) return { title: "Workshop | Pottery" };
  return {
    title: `${workshop.name} | Pottery`,
    description: workshop.description ?? "Workshop de Pottery by Juli.",
  };
}

export default async function PublicWorkshopPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const workshop = await getPublicWorkshop(slug);
  if (!workshop) notFound();

  const spotsLeft = workshop.capacity != null ? Math.max(0, workshop.capacity - workshop.confirmedCount) : null;

  return (
    <div className="flex flex-col gap-5">
      {workshop.imageUrl && (
        <div className="relative -mx-4 aspect-[4/3] w-[calc(100%+2rem)] overflow-hidden bg-muted sm:mx-0 sm:w-full sm:rounded-lg">
          <Image
            src={workshop.imageUrl}
            alt={workshop.name}
            fill
            sizes="(max-width: 640px) 100vw, 640px"
            className="object-cover"
            unoptimized
            priority
          />
        </div>
      )}

      <div>
        <h1 className="text-xl font-semibold tracking-tight">{workshop.name}</h1>
        {workshop.description && (
          <p className="mt-1 text-sm text-muted-foreground">{workshop.description}</p>
        )}
      </div>

      <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4 text-sm">
        <Row label="Fecha" value={formatDate(workshop.event_date)} />
        {workshop.start_time && (
          <Row
            label="Horario"
            value={`${workshop.start_time.slice(0, 5)}${workshop.end_time ? ` a ${workshop.end_time.slice(0, 5)}` : ""}hs`}
          />
        )}
        {workshop.locationName && <Row label="Lugar" value={workshop.locationName} />}
        {workshop.address && <Row label="Dirección" value={workshop.address} />}
        {workshop.price != null && <Row label="Precio" value={formatCurrency(workshop.price)} />}
      </div>

      <div>
        {spotsLeft != null ? (
          spotsLeft > 0 ? (
            <Badge variant="secondary">{spotsLeft} lugares disponibles</Badge>
          ) : (
            <Badge variant="destructive">Cupo completo</Badge>
          )
        ) : null}
      </div>

      {workshop.additional_info && (
        <div className="rounded-lg border border-border bg-secondary/30 p-4 text-sm">
          <p className="mb-1 font-medium">Qué incluye / condiciones</p>
          <p className="whitespace-pre-wrap text-muted-foreground">{workshop.additional_info}</p>
        </div>
      )}

      {workshop.paymentAccount?.alias && (
        <div className="rounded-lg border border-border bg-card p-4 text-sm">
          <p className="mb-1 font-medium">Forma de pago — Transferencia</p>
          <p className="text-muted-foreground">Alias: {workshop.paymentAccount.alias}</p>
          {workshop.paymentAccount.holder_name && (
            <p className="text-muted-foreground">Titular: {workshop.paymentAccount.holder_name}</p>
          )}
        </div>
      )}

      <RegistrationForm workshop={workshop} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
