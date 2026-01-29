import Link from "next/link";
import { useSession } from "@/lib/useSession";
import { isSpecialistUser } from "@/lib/specialist";

export function SpecialistNav() {
  const { session, user } = useSession();
  if (!session || !user) return null;
  if (!isSpecialistUser(user)) return null;

  return (
    <Link
      href="/specialist"
      className="rounded-lg border bg-white px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-zinc-50"
    >
      Специалист
    </Link>
  );
}
