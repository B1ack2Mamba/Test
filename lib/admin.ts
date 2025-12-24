export const ADMIN_EMAIL = (
  process.env.NEXT_PUBLIC_ADMIN_EMAIL ||
  // Fallback for local builds
  "storyguild9@gmail.com"
).toLowerCase();

export function isAdminEmail(email?: string | null) {
  return (email ?? "").toLowerCase() === ADMIN_EMAIL;
}
