import Image from "next/image";

export const metadata = {
  title: "Workshops | Pottery",
  description: "Workshops de Pottery by Juli.",
};

export default function WorkshopsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-background">
      <header className="flex items-center gap-2 border-b border-border bg-background/95 px-4 py-2">
        <Image
          src="/brand/pottery-logo.png"
          alt="Pottery by Juli"
          width={2000}
          height={2000}
          sizes="48px"
          priority
          className="h-12 w-12"
          style={{ objectFit: "contain" }}
        />
        <span className="text-sm text-muted-foreground">Workshops</span>
      </header>
      <main className="px-4 py-4 sm:px-0">{children}</main>
    </div>
  );
}
