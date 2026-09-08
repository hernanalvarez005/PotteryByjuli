import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AppRole = "owner" | "operations" | "workshop_staff" | "viewer";

export type CurrentUser = {
  id: string;
  email: string | null;
  fullName: string | null;
  roles: AppRole[];
};

/**
 * Reads the signed-in user plus their roles (`user_roles`).
 * Returns `null` when nobody is signed in — callers decide whether that's
 * an error (see `requireUser`) or an expected state (public pages).
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const [{ data: profile }, { data: roleRows }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", user.id),
  ]);

  return {
    id: user.id,
    email: user.email ?? null,
    fullName: (profile?.full_name as string | null) ?? null,
    roles: (roleRows?.map((r) => r.role) ?? []) as AppRole[],
  };
}

/** Use in Server Components/Actions that must never render for a guest. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export function hasRole(user: CurrentUser, role: AppRole): boolean {
  return user.roles.includes(role);
}

export function isOwner(user: CurrentUser): boolean {
  return hasRole(user, "owner");
}
