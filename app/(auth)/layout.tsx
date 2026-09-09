import Image from "next/image";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="flex w-full max-w-[420px] flex-col items-center">
        <Image
          src="/brand/pottery-logo.png"
          alt="Pottery by Juli"
          width={2000}
          height={2000}
          priority
          sizes="176px"
          className="mb-2 h-auto w-40 sm:w-44"
          style={{ objectFit: "contain" }}
        />
        <div className="mb-8 text-center">
          <h1 className="font-heading text-xl font-semibold text-foreground">
            Bienvenida a Pottery
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Ingresá para gestionar tu negocio.
          </p>
        </div>
        <div className="w-full">{children}</div>
      </div>
    </div>
  );
}
