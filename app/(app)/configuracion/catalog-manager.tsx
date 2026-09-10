"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import type { CatalogField, CatalogRow, CatalogTableKey } from "@/lib/catalog";
import { createCatalogItem, toggleCatalogItemActive } from "./actions";

export function CatalogManager({
  table,
  label,
  description,
  fields,
  rows,
  canEdit,
}: {
  table: CatalogTableKey;
  label: string;
  description: string;
  fields: readonly CatalogField[];
  rows: CatalogRow[];
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const action = createCatalogItem.bind(null, table);
  const [state, formAction, isPending] = useActionState(action, {});

  // Close the dialog once a submission finishes without error. We can't rely
  // on the form's `action` callback for this: useActionState resolves the
  // new state asynchronously, one render after the form action itself runs.
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !isPending && !state.error) {
      setOpen(false);
    }
    wasPending.current = isPending;
  }, [isPending, state.error]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-medium">{label}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {canEdit && (
          <Dialog
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
            }}
          >
            <DialogTrigger render={<Button size="sm" variant="outline" />}>
              <Plus className="size-4" />
              Agregar
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nuevo en {label.toLowerCase()}</DialogTitle>
              </DialogHeader>
              <NewItemForm
                fields={fields}
                formAction={formAction}
                error={state.error}
                isPending={isPending}
              />
            </DialogContent>
          </Dialog>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          Todavía no cargaste nada acá.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Estado</TableHead>
              {canEdit && <TableHead className="text-right">Acciones</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <RowLine key={row.id} table={table} row={row} canEdit={canEdit} />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function RowLine({
  table,
  row,
  canEdit,
}: {
  table: CatalogTableKey;
  row: CatalogRow;
  canEdit: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <TableRow>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {row.code}
      </TableCell>
      <TableCell>{row.name}</TableCell>
      <TableCell>
        <Badge variant={row.is_active ? "secondary" : "outline"}>
          {row.is_active ? "Activo" : "Inactivo"}
        </Badge>
      </TableCell>
      {canEdit && (
        <TableCell className="text-right">
          <Button
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={() =>
              startTransition(() =>
                toggleCatalogItemActive(table, row.id, !row.is_active)
              )
            }
          >
            {row.is_active ? "Desactivar" : "Activar"}
          </Button>
        </TableCell>
      )}
    </TableRow>
  );
}

function NewItemForm({
  fields,
  formAction,
  error,
  isPending,
}: {
  fields: readonly CatalogField[];
  formAction: (formData: FormData) => void;
  error?: string;
  isPending: boolean;
}) {
  return (
    <form action={formAction} className="flex flex-col gap-4">
      {fields.map((field) => (
        <div key={field.name} className="space-y-2">
          <Label htmlFor={field.name}>{field.label}</Label>
          {field.type === "select" ? (
            <Select name={field.name} items={field.options} defaultValue={field.options?.[0]?.value}>
              <SelectTrigger id={field.name} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {field.options?.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id={field.name}
              name={field.name}
              placeholder={field.placeholder}
              required={field.name === "code" || field.name === "name"}
            />
          )}
        </div>
      ))}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Guardando..." : "Guardar"}
        </Button>
      </DialogFooter>
    </form>
  );
}
