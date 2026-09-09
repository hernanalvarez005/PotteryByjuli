import Image from "next/image";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { SidebarNav } from "@/components/sidebar-nav";
import { MobileNav } from "@/components/mobile-nav";
import { UserMenu } from "@/components/user-menu";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r border-sidebar-border bg-sidebar md:block">
        <div className="flex h-20 items-center justify-center border-b border-sidebar-border px-4">
          <Link href="/dashboard">
            <Image
              src="/brand/pottery-logo.png"
              alt="Pottery by Juli"
              width={2000}
              height={2000}
              priority
              sizes="96px"
              className="h-auto w-24"
              style={{ objectFit: "contain" }}
            />
          </Link>
        </div>
        <SidebarNav />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-2 border-b border-border bg-background px-4">
          <MobileNav />
          <Link href="/dashboard" className="md:hidden">
            <Image
              src="/brand/pottery-logo.png"
              alt="Pottery by Juli"
              width={2000}
              height={2000}
              sizes="44px"
              className="h-11 w-11"
              style={{ objectFit: "contain" }}
            />
          </Link>
          <div className="ml-auto">
            <UserMenu user={user} />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
