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
 * Returns `null` when nobody is signed in, OR when their account was
 * deactivated (`profiles.is_active = false`) — from the app's point of
 * view that's the same as being logged out. The database independently
 * enforces this too (has_role()/is_owner() both check is_active), so this
 * is about giving a clear "your access was revoked" redirect instead of a
 * dashboard full of buttons that fail with a raw Postgres error.
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
      .select("full_name, is_active")
      .eq("id", user.id)
      .maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", user.id),
  ]);

  if (profile && profile.is_active === false) {
    await supabase.auth.signOut();
    return null;
  }

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
