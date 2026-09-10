import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import path from "node:path";

// Server-only: reads a real file off disk (the Pottery logo) and renders a
// PDF without a headless browser. Never import this from a "use client"
// file. Runs from a Server Action, which on this project defaults to the
// Node.js runtime (no `export const runtime = "edge"` anywhere) — that's
// required here, since @react-pdf/renderer and `fs`-backed image loading
// don't work on the Edge runtime.
//
// Everything this module needs comes in by parameter — it never queries
// `customers`, `wholesale_settings`, or current product prices itself. The
// caller is responsible for reading `order_items` (already-historical
// `unit_price`) and the order's own `wholesale_terms_snapshot` /
// `wholesale_buyer_snapshot` (buyer info exactly as submitted, frozen at
// request time). This is what makes a later regeneration byte-for-byte
// equivalent to the original even if today's live prices/conditions/buyer
// record have since changed — see docs/business-rules.md § Checkout
// mayorista.

const COLORS = {
  ink: "#273128",
  sage: "#687866",
  sageSoft: "#E7ECE5",
  sand: "#EEE9DE",
  stone: "#D8D5CC",
  muted: "#687068",
};

const LOGO_PATH = path.join(process.cwd(), "public/brand/pottery-logo.png");

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, color: COLORS.ink, fontFamily: "Helvetica" },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  logo: { width: 48, height: 48, marginRight: 12 },
  brand: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  subtitle: { fontSize: 10, color: COLORS.muted },
  banner: { backgroundColor: COLORS.sageSoft, borderRadius: 4, padding: 10, marginBottom: 16 },
  bannerTitle: { fontSize: 11, fontFamily: "Helvetica-Bold", color: COLORS.sage, marginBottom: 4 },
  bannerText: { fontSize: 9, color: COLORS.ink, lineHeight: 1.4 },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    marginTop: 14,
    marginBottom: 6,
    color: COLORS.sage,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.stone,
    paddingBottom: 3,
  },
  row: { flexDirection: "row", marginBottom: 3 },
  label: { width: 130, color: COLORS.muted },
  value: { flex: 1 },
  table: { marginTop: 4 },
  tableHeaderRow: { flexDirection: "row", backgroundColor: COLORS.sand, paddingVertical: 4, paddingHorizontal: 4 },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.stone,
  },
  colProduct: { flex: 3 },
  colVariant: { flex: 2 },
  colQty: { flex: 1, textAlign: "right" },
  colPrice: { flex: 1.5, textAlign: "right" },
  colSubtotal: { flex: 1.5, textAlign: "right" },
  tableHeaderText: { fontFamily: "Helvetica-Bold", fontSize: 9 },
  totalsBox: { marginTop: 10, alignItems: "flex-end" },
  totalsRow: { flexDirection: "row", marginBottom: 2 },
  totalsLabel: { width: 140, textAlign: "right", marginRight: 8, color: COLORS.muted },
  totalsValue: { width: 90, textAlign: "right", fontFamily: "Helvetica-Bold" },
  footer: { marginTop: 20, fontSize: 8, color: COLORS.muted, textAlign: "center" },
});

export type WholesaleOrderPdfBuyer = {
  first_name: string;
  last_name: string | null;
  company_name: string | null;
  cuit: string | null;
  instagram: string | null;
  website: string | null;
  city: string | null;
  province: string | null;
  address: string | null;
  postal_code: string | null;
  whatsapp: string;
  email: string | null;
};

export type WholesaleOrderPdfItem = {
  productName: string;
  variantName: string;
  quantity: number;
  unitPrice: number;
};

export type WholesaleOrderPdfTerms = {
  min_order_amount: number | null;
  min_total_units: number | null;
  lead_time_min_days: number | null;
  lead_time_max_days: number | null;
  payment_terms: string | null;
  shipping_terms: string | null;
};

export type WholesaleOrderPdfInput = {
  humanCode: string;
  createdAt: Date;
  buyer: WholesaleOrderPdfBuyer;
  items: WholesaleOrderPdfItem[];
  terms: WholesaleOrderPdfTerms;
};

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

/** A labeled row that renders nothing at all when the value is absent —
 * "mostrar sólo los campos con valor" (sección 28 del brief), never an
 * empty line for a field the buyer left blank. */
function InfoRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

export function WholesaleOrderPdfDocument({ humanCode, createdAt, buyer, items, terms }: WholesaleOrderPdfInput) {
  const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalAmount = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const buyerName = [buyer.first_name, buyer.last_name].filter(Boolean).join(" ");
  const leadTime =
    terms.lead_time_min_days != null && terms.lead_time_max_days != null
      ? `${terms.lead_time_min_days}–${terms.lead_time_max_days} días`
      : terms.lead_time_min_days != null || terms.lead_time_max_days != null
        ? `${terms.lead_time_min_days ?? terms.lead_time_max_days} días`
        : null;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- this is @react-pdf/renderer's Image (a PDF drawing primitive), not an HTML <img>; it has no alt concept. */}
          <Image src={LOGO_PATH} style={styles.logo} />
          <View>
            <Text style={styles.brand}>POTTERY BY JULI</Text>
            <Text style={styles.subtitle}>Solicitud de pedido mayorista</Text>
          </View>
        </View>

        <InfoRow label="Pedido" value={humanCode} />
        <InfoRow label="Fecha" value={formatDate(createdAt)} />

        <View style={styles.banner}>
          <Text style={styles.bannerTitle}>SOLICITUD PENDIENTE DE CONFIRMACIÓN</Text>
          <Text style={styles.bannerText}>
            Este documento corresponde a una solicitud de pedido mayorista. El pedido quedará
            confirmado una vez que Pottery revise disponibilidad, plazos y condiciones y confirme
            la solicitud.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Datos del comprador</Text>
        <InfoRow label="Nombre" value={buyerName || null} />
        <InfoRow label="Razón social / Comercio" value={buyer.company_name} />
        <InfoRow label="CUIT" value={buyer.cuit} />
        <InfoRow label="WhatsApp" value={buyer.whatsapp} />
        <InfoRow label="Email" value={buyer.email} />
        <InfoRow label="Ciudad" value={buyer.city} />
        <InfoRow label="Provincia" value={buyer.province} />
        <InfoRow label="Dirección" value={buyer.address} />
        <InfoRow label="Código postal" value={buyer.postal_code} />
        <InfoRow label="Instagram" value={buyer.instagram} />
        <InfoRow label="Web" value={buyer.website} />

        <Text style={styles.sectionTitle}>Detalle del pedido</Text>
        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={{ ...styles.colProduct, ...styles.tableHeaderText }}>Producto</Text>
            <Text style={{ ...styles.colVariant, ...styles.tableHeaderText }}>Variante</Text>
            <Text style={{ ...styles.colQty, ...styles.tableHeaderText }}>Cantidad</Text>
            <Text style={{ ...styles.colPrice, ...styles.tableHeaderText }}>Precio unitario</Text>
            <Text style={{ ...styles.colSubtotal, ...styles.tableHeaderText }}>Subtotal</Text>
          </View>
          {items.map((item, index) => (
            <View style={styles.tableRow} key={index}>
              <Text style={styles.colProduct}>{item.productName}</Text>
              <Text style={styles.colVariant}>{item.variantName !== "Único" ? item.variantName : ""}</Text>
              <Text style={styles.colQty}>{item.quantity}</Text>
              <Text style={styles.colPrice}>{formatCurrency(item.unitPrice)}</Text>
              <Text style={styles.colSubtotal}>{formatCurrency(item.quantity * item.unitPrice)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalsBox}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Cantidad total de piezas</Text>
            <Text style={styles.totalsValue}>{totalUnits}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Total</Text>
            <Text style={styles.totalsValue}>{formatCurrency(totalAmount)}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Condiciones</Text>
        <InfoRow
          label="Pedido mínimo"
          value={terms.min_order_amount != null ? formatCurrency(terms.min_order_amount) : null}
        />
        <InfoRow
          label="Mínimo de piezas"
          value={terms.min_total_units != null ? String(terms.min_total_units) : null}
        />
        <InfoRow label="Plazo estimado" value={leadTime} />
        <InfoRow label="Forma de pago" value={terms.payment_terms} />
        <InfoRow label="Envío" value={terms.shipping_terms} />

        <Text style={styles.footer}>
          Pottery by Juli · Este documento no reemplaza una factura ni implica un pago confirmado.
        </Text>
      </Page>
    </Document>
  );
}

/** Renders the wholesale request PDF to a Buffer. See the module comment
 * above for why every input here must already be historical/frozen. */
export async function renderWholesaleOrderPdf(input: WholesaleOrderPdfInput): Promise<Buffer> {
  return renderToBuffer(<WholesaleOrderPdfDocument {...input} />);
}
