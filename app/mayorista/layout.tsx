import { CartProvider } from "./cart-context";

export const metadata = {
  title: "Pottery Mayorista",
  description: "Catálogo mayorista de Pottery — armá tu pedido online.",
};

export default function MayoristaLayout({ children }: { children: React.ReactNode }) {
  return (
    <CartProvider>
      <div className="mx-auto min-h-screen max-w-3xl bg-background">
        <header className="sticky top-0 z-40 border-b bg-background/95 px-4 py-3 backdrop-blur">
          <span className="text-lg font-semibold tracking-tight">Pottery</span>
          <span className="ml-2 text-sm text-muted-foreground">Mayorista</span>
        </header>
        <main className="px-4 pb-28 pt-4">{children}</main>
      </div>
    </CartProvider>
  );
}
