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
      className="btn btn-secondary btn-sm"
    >
      Специалист
    </Link>
  );
}
