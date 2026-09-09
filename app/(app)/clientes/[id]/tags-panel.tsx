"use client";

import { useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toggleCustomerTag } from "../actions";

export type Tag = { id: string; name: string };

export function TagsPanel({
  customerId,
  allTags,
  activeTagIds,
  canEdit,
}: {
  customerId: string;
  allTags: Tag[];
  activeTagIds: string[];
  canEdit: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const activeSet = new Set(activeTagIds);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Segmentos</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {allTags.map((tag) => {
          const isActive = activeSet.has(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              disabled={!canEdit || isPending}
              onClick={() =>
                startTransition(() => toggleCustomerTag(customerId, tag.id, !isActive))
              }
              className="disabled:cursor-default"
            >
              <Badge variant={isActive ? "secondary" : "outline"}>{tag.name}</Badge>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}
