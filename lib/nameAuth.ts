export function normalizeHumanNamePart(value: string) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function formatHumanNamePart(value: string) {
  const trimmed = String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  return trimmed
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function buildDisplayName(firstName: string, lastName: string) {
  return [formatHumanNamePart(firstName), formatHumanNamePart(lastName)].filter(Boolean).join(" ").trim();
}

export function buildNormalizedFullName(firstName: string, lastName: string) {
  return [normalizeHumanNamePart(firstName), normalizeHumanNamePart(lastName)].filter(Boolean).join(" ").trim();
}

export function getPreferredUserName(user: any) {
  const meta = (user as any)?.user_metadata || {};
  const firstName = String(meta?.first_name || "").trim();
  const lastName = String(meta?.last_name || "").trim();
  const displayName = String(meta?.display_name || "").trim();
  return displayName || [firstName, lastName].filter(Boolean).join(" ").trim() || String((user as any)?.email || "").split("@")[0] || "";
}
