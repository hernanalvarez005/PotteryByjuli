import Image from "next/image";
import { CartProvider } from "./cart-context";

export const metadata = {
  title: "Pottery Mayorista",
  description: "Catálogo mayorista de Pottery — armá tu pedido online.",
};

export default function MayoristaLayout({ children }: { children: React.ReactNode }) {
  return (
    <CartProvider>
      <div className="mx-auto min-h-screen max-w-3xl bg-background">
        <header className="sticky top-0 z-40 flex items-center gap-2 border-b border-border bg-background/95 px-4 py-2 backdrop-blur">
          <Image
            src="/brand/pottery-logo.png"
            alt="Pottery by Juli"
            width={2000}
            height={2000}
            priority
            sizes="48px"
            className="h-12 w-12"
            style={{ objectFit: "contain" }}
          />
          <span className="text-sm text-muted-foreground">Mayorista</span>
        </header>
        <main className="px-4 pb-28 pt-4">{children}</main>
      </div>
    </CartProvider>
  );
}
