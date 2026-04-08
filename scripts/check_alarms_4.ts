import { createClient } from '@supabase/supabase-js';
const supabaseUrl = "https://jncvvsvckxhqgqvkppmj.supabase.co";
const supabaseServiceKey = "sb_secret_38LbpgEn50YEw3XAASDQjQ_bZJsksY5";
const supabase = createClient(supabaseUrl, supabaseServiceKey);
async function run() {
  try {
    const email = 'alarms.leads@gmail.com';
    const { data: { users }, error } = await supabase.auth.admin.listUsers();
    if (error) { console.error('listUsers error', error); return; }
    const user = users.find(u => u.email === email);
    if (user) console.log("Auth User:", JSON.stringify({ id: user.id, email: user.email, meta: user.raw_user_meta_data }, null, 2));
    else console.log("Not found in auth.users");
    const { data: profile, error: pError } = await supabase.from('profiles').select('*').eq('email', email);
    if (pError) console.error('profiles error', pError);
    console.log("Profile:", JSON.stringify(profile, null, 2));
  } catch (err) {
    console.error('fatal', err);
  }
}
run();
