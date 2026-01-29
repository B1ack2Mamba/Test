/**
 * Specialist role.
 *
 * Server routes use SPECIALIST_EMAILS (comma-separated) OR NEXT_PUBLIC_ADMIN_EMAIL fallback.
 * Client UI can use NEXT_PUBLIC_SPECIALIST_EMAILS to show links, but server is authoritative.
 */

export function normalizeEmail(email: string | null | undefined) {
  return (email || "").trim().toLowerCase();
}

export function isSpecialistEmail(email: string | null | undefined) {
  const e = normalizeEmail(email);
  if (!e) return false;

  // Server-side list
  const serverList = (process.env.SPECIALIST_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (serverList.length && serverList.includes(e)) return true;

  // Public list (optional)
  const publicList = (process.env.NEXT_PUBLIC_SPECIALIST_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (publicList.length && publicList.includes(e)) return true;

  // Fallback to existing admin email env used elsewhere
  const adminEmail = (process.env.NEXT_PUBLIC_ADMIN_EMAIL || "storyguild9@gmail.com").trim().toLowerCase();
  return e === adminEmail;
}

/**
 * Prefer role stored in Supabase user metadata.
 * Fallback to email allowlist for backward compatibility.
 */
export function isSpecialistUser(user: any): boolean {
  const role = user?.app_metadata?.role || user?.user_metadata?.role;
  if (role === "specialist") return true;
  return isSpecialistEmail(user?.email);
}
