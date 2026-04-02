import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function deleteUsers() {
  const targetEmail = 'cgarness.ffl@gmail.com';
  let hasMore = true;
  let page = 1;
  let totalDeleted = 0;

  while (hasMore) {
    const { data: { users }, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    
    if (error) {
      console.error('Error fetching users:', error);
      process.exit(1);
    }
    
    if (users.length === 0) {
      hasMore = false;
      break;
    }

    console.log(`Page ${page}: Found ${users.length} users.`);
    
    for (const user of users) {
      if (user.email === targetEmail) {
        console.log(`Skipping super admin: ${user.email} (${user.id})`);
        continue;
      }
      console.log(`Deleting: ${user.email || 'No email'} (${user.id})`);
      const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);
      if (deleteError) {
        console.error(`Failed to delete ${user.email}:`, deleteError.message);
      } else {
        totalDeleted++;
        console.log(`Successfully deleted ${user.email}`);
      }
    }
    
    if (users.length < 1000) {
      hasMore = false;
    } else {
      page++;
    }
  }
  
  console.log(`\nCompleted. Purged ${totalDeleted} users.`);
}

deleteUsers();
