import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import path from "node:path";

// Server-only — mismo motivo/infraestructura que lib/wholesale-pdf.tsx
// (nunca importar desde un archivo "use client"; necesita el runtime
// Node.js, no Edge). "Resumen PDF del pedido" (order_summary_pdf) —
// sección 10/11 de la tanda de usabilidad — reusa el renderer, el
// branding, el bucket privado y el flujo de signed URL ya construidos
// para el PDF mayorista (wholesale_request_pdf). Nunca duplica esa
// infraestructura, sólo agrega un `kind` distinto en order_attachments.
//
// Todo lo que entra acá ya es histórico: order_items.unit_price nunca se
// vuelve a consultar contra price_list_items, y los pagos vienen de
// `payments` tal como quedaron registrados — nunca precios/condiciones
// actuales del catálogo.

const COLORS = {
  ink: "#273128",
  sage: "#687866",
  sageSoft: "#E7ECE5",
  sand: "#EEE9DE",
  stone: "#D8D5CC",
  muted: "#687068",
  amber: "#8a5a12",
};

const LOGO_PATH = path.join(process.cwd(), "public/brand/pottery-logo.png");

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, color: COLORS.ink, fontFamily: "Helvetica" },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  logo: { width: 48, height: 48, marginRight: 12 },
  brand: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  subtitle: { fontSize: 10, color: COLORS.muted },
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
  colQty: { flex: 1, textAlign: "right" },
  colPrice: { flex: 1.5, textAlign: "right" },
  colSubtotal: { flex: 1.5, textAlign: "right" },
  tableHeaderText: { fontFamily: "Helvetica-Bold", fontSize: 9 },
  itemNote: { fontSize: 8, color: COLORS.muted, marginTop: 1 },
  totalsBox: { marginTop: 10, alignItems: "flex-end" },
  totalsRow: { flexDirection: "row", marginBottom: 2 },
  totalsLabel: { width: 140, textAlign: "right", marginRight: 8, color: COLORS.muted },
  totalsValue: { width: 90, textAlign: "right", fontFamily: "Helvetica-Bold" },
  balanceValue: { width: 90, textAlign: "right", fontFamily: "Helvetica-Bold", color: COLORS.amber },
  footer: { marginTop: 20, fontSize: 8, color: COLORS.muted, textAlign: "center" },
});

export type OrderPdfItem = {
  label: string;
  note: string | null;
  quantity: number;
  unitPrice: number;
};

export type OrderPdfPayment = {
  amount: number;
  paidAt: Date;
  methodName: string | null;
};

export type OrderPdfInput = {
  humanCode: string;
  createdAt: Date;
  customerName: string | null;
  items: OrderPdfItem[];
  payments: OrderPdfPayment[];
  estimatedDate: Date | null;
  notes: string | null;
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

function InfoRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

export function OrderPdfDocument({ humanCode, createdAt, customerName, items, payments, estimatedDate, notes }: OrderPdfInput) {
  const total = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const paid = payments.reduce((sum, p) => sum + p.amount, 0);
  const balance = total - paid;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer's Image (PDF primitive), no alt concept. */}
          <Image src={LOGO_PATH} style={styles.logo} />
          <View>
            <Text style={styles.brand}>POTTERY BY JULI</Text>
            <Text style={styles.subtitle}>Resumen de pedido</Text>
          </View>
        </View>

        <InfoRow label="Pedido" value={humanCode} />
        <InfoRow label="Fecha" value={formatDate(createdAt)} />
        <InfoRow label="Cliente" value={customerName} />
        <InfoRow label="Fecha de entrega" value={estimatedDate ? formatDate(estimatedDate) : null} />

        <Text style={styles.sectionTitle}>Productos</Text>
        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={{ ...styles.colProduct, ...styles.tableHeaderText }}>Producto</Text>
            <Text style={{ ...styles.colQty, ...styles.tableHeaderText }}>Cantidad</Text>
            <Text style={{ ...styles.colPrice, ...styles.tableHeaderText }}>Precio unitario</Text>
            <Text style={{ ...styles.colSubtotal, ...styles.tableHeaderText }}>Subtotal</Text>
          </View>
          {items.map((item, index) => (
            <View style={styles.tableRow} key={index}>
              <View style={styles.colProduct}>
                <Text>{item.label}</Text>
                {item.note && <Text style={styles.itemNote}>{item.note}</Text>}
              </View>
              <Text style={styles.colQty}>{item.quantity}</Text>
              <Text style={styles.colPrice}>{formatCurrency(item.unitPrice)}</Text>
              <Text style={styles.colSubtotal}>{formatCurrency(item.quantity * item.unitPrice)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalsBox}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Total</Text>
            <Text style={styles.totalsValue}>{formatCurrency(total)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Pagos registrados</Text>
            <Text style={styles.totalsValue}>{formatCurrency(paid)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Saldo pendiente</Text>
            <Text style={balance > 0 ? styles.balanceValue : styles.totalsValue}>{formatCurrency(balance)}</Text>
          </View>
        </View>

        {payments.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Pagos</Text>
            {payments.map((p, index) => (
              <View style={styles.row} key={index}>
                <Text style={styles.label}>{formatDate(p.paidAt)}</Text>
                <Text style={styles.value}>
                  {formatCurrency(p.amount)}
                  {p.methodName ? ` · ${p.methodName}` : ""}
                </Text>
              </View>
            ))}
          </>
        )}

        {notes && (
          <>
            <Text style={styles.sectionTitle}>Observaciones</Text>
            <Text>{notes}</Text>
          </>
        )}

        <Text style={styles.footer}>Pottery by Juli · Documento generado desde el sistema de gestión.</Text>
      </Page>
    </Document>
  );
}

export async function renderOrderPdf(input: OrderPdfInput): Promise<Buffer> {
  return renderToBuffer(<OrderPdfDocument {...input} />);
}
