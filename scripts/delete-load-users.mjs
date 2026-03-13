import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const MODE = process.argv.includes('--delete') ? 'delete' : 'dry-run';

function isLoadUser(user) {
  const meta = user.user_metadata || {};
  const displayName =
    meta.display_name ||
    meta.full_name ||
    meta.name ||
    '';

  const email = (user.email || '').toLowerCase();

  return (
    typeof displayName === 'string' &&
    displayName.startsWith('Load User')
  ) || (
    email.startsWith('guest+') &&
    typeof displayName === 'string' &&
    displayName.length > 0
  );
}

async function listAllUsers() {
  const users = [];
  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) throw error;

    const batch = data?.users || [];
    users.push(...batch);

    if (batch.length < perPage) break;
    page += 1;
  }

  return users;
}

async function main() {
  const users = await listAllUsers();
  const candidates = users.filter(isLoadUser);

  console.log(`Mode: ${MODE}`);
  console.log(`Total users: ${users.length}`);
  console.log(`Matched load users: ${candidates.length}`);
  console.log();

  for (const u of candidates.slice(0, 30)) {
    const meta = u.user_metadata || {};
    const displayName =
      meta.display_name ||
      meta.full_name ||
      meta.name ||
      '';

    console.log(`${u.id} | ${displayName} | ${u.email || '-'}`);
  }

  if (candidates.length > 30) {
    console.log(`...and ${candidates.length - 30} more`);
  }

  if (MODE !== 'delete') return;

  let deleted = 0;
  let failed = 0;

  for (const u of candidates) {
    const { error } = await supabase.auth.admin.deleteUser(u.id);
    if (error) {
      failed += 1;
      console.error(`DELETE FAILED: ${u.id} | ${u.email || '-'} | ${error.message}`);
    } else {
      deleted += 1;
    }
  }

  console.log();
  console.log({ deleted, failed });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});