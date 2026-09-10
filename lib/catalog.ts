import { z } from "zod";

const codeSchema = z
  .string()
  .trim()
  .min(1, "Requerido")
  .max(40)
  .regex(/^[a-z0-9_-]+$/, "Usá minúsculas, números, - o _");
const nameSchema = z.string().trim().min(1, "Requerido").max(80);

export type CatalogField = {
  name: string;
  label: string;
  type: "text" | "select";
  options?: { value: string; label: string }[];
  placeholder?: string;
};

/**
 * Single registry of every configuration catalog exposed on
 * `/configuracion`: validation schema (server-side truth) + the form
 * fields the UI renders. Keeping both together means a new catalog table
 * only needs one entry here, not a bespoke form component.
 */
export const CATALOG_TABLES = {
  business_units: {
    label: "Unidades de negocio",
    description: "Las áreas comerciales de Pottery (minorista, mayorista, talleres, etc.).",
    schema: z.object({ code: codeSchema, name: nameSchema }),
    fields: [
      { name: "code", label: "Código", type: "text", placeholder: "wholesale" },
      { name: "name", label: "Nombre", type: "text", placeholder: "Mayorista" },
    ] satisfies CatalogField[],
  },
  locations: {
    label: "Ubicaciones",
    description: "Puntos físicos donde hay stock, ventas o eventos.",
    schema: z.object({
      code: codeSchema,
      name: nameSchema,
      location_type: z.enum(["store", "warehouse", "fair", "showroom", "other"]),
      city: z.string().trim().max(80).optional().or(z.literal("")),
      province: z.string().trim().max(80).optional().or(z.literal("")),
    }),
    fields: [
      { name: "code", label: "Código", type: "text", placeholder: "la-plata" },
      { name: "name", label: "Nombre", type: "text", placeholder: "La Plata" },
      {
        name: "location_type",
        label: "Tipo",
        type: "select",
        options: [
          { value: "store", label: "Local" },
          { value: "warehouse", label: "Depósito" },
          { value: "fair", label: "Feria" },
          { value: "showroom", label: "Showroom" },
          { value: "other", label: "Otro" },
        ],
      },
      { name: "city", label: "Ciudad", type: "text" },
      { name: "province", label: "Provincia", type: "text" },
    ] satisfies CatalogField[],
  },
  sales_channels: {
    label: "Canales de venta",
    description: "Se usan tanto como origen comercial como canal de cierre en los pedidos.",
    schema: z.object({ code: codeSchema, name: nameSchema }),
    fields: [
      { name: "code", label: "Código", type: "text", placeholder: "instagram" },
      { name: "name", label: "Nombre", type: "text", placeholder: "Instagram" },
    ] satisfies CatalogField[],
  },
  payment_methods: {
    label: "Métodos de pago",
    description: "Cómo paga el cliente (no confundir con la cuenta donde ingresa el dinero).",
    schema: z.object({ code: codeSchema, name: nameSchema }),
    fields: [
      { name: "code", label: "Código", type: "text", placeholder: "bank_transfer" },
      { name: "name", label: "Nombre", type: "text", placeholder: "Transferencia" },
    ] satisfies CatalogField[],
  },
  payment_accounts: {
    label: "Cuentas / cajas",
    description: "Dónde queda efectivamente la plata (caja, banco, Mercado Pago).",
    schema: z.object({
      code: codeSchema,
      name: nameSchema,
      account_type: z.enum(["cash", "bank", "digital_wallet", "other"]),
    }),
    fields: [
      { name: "code", label: "Código", type: "text", placeholder: "cash-box" },
      { name: "name", label: "Nombre", type: "text", placeholder: "Caja efectivo" },
      {
        name: "account_type",
        label: "Tipo",
        type: "select",
        options: [
          { value: "cash", label: "Efectivo" },
          { value: "bank", label: "Banco" },
          { value: "digital_wallet", label: "Billetera digital" },
          { value: "other", label: "Otro" },
        ],
      },
    ] satisfies CatalogField[],
  },
  workshop_due_concepts: {
    label: "Conceptos de cargos extra",
    description: "Cargos puntuales que se agregan arriba de una cuota mensual de talleres (arcilla, esmalte, etc.).",
    schema: z.object({ code: codeSchema, name: nameSchema }),
    fields: [
      { name: "code", label: "Código", type: "text", placeholder: "arcilla" },
      { name: "name", label: "Nombre", type: "text", placeholder: "Arcilla" },
    ] satisfies CatalogField[],
  },
} as const;

export type CatalogTableKey = keyof typeof CATALOG_TABLES;
export const CATALOG_TABLE_KEYS = Object.keys(CATALOG_TABLES) as CatalogTableKey[];

export type CatalogRow = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  [key: string]: unknown;
};
