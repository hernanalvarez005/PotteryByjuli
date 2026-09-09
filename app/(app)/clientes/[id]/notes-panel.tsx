"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { addCustomerNote } from "../actions";

export type Note = {
  id: string;
  note: string;
  created_at: string;
  author_name: string | null;
};

export function NotesPanel({
  customerId,
  notes,
  canEdit,
}: {
  customerId: string;
  notes: Note[];
  canEdit: boolean;
}) {
  const boundAction = addCustomerNote.bind(null, customerId);
  const [state, formAction, isPending] = useActionState(boundAction, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Notas internas</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin notas todavía.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {notes.map((n) => (
              <li key={n.id} className="rounded-md border p-3 text-sm">
                <p className="whitespace-pre-wrap">{n.note}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {n.author_name ?? "—"} · {formatDateTime(n.created_at)}
                </p>
              </li>
            ))}
          </ul>
        )}

        {canEdit && (
          <form action={formAction} className="flex flex-col gap-2 border-t pt-4">
            <Textarea name="note" rows={2} placeholder="Agregar una nota..." required />
            {state.error && <p className="text-sm text-destructive">{state.error}</p>}
            <Button type="submit" variant="outline" disabled={isPending} className="self-start">
              {isPending ? "Guardando..." : "Agregar nota"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
