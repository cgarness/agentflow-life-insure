import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'YOUR_URL_HERE';
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'YOUR_KEY_HERE';

// Actually, I can just use the provided client since I run this from the repo
// Wait, I can't easily run it if env vars aren't injected.
// Let me read "src/integrations/supabase/client.ts" to see if it reads from process.env

import * as fs from 'fs';
const envPath = '/Users/CHRIS/AgentFlow/agentflow-life-insure/.env';
const envLocalPath = '/Users/CHRIS/AgentFlow/agentflow-life-insure/.env.local';

function parseEnv(path: string) {
  if (fs.existsSync(path)) {
    const lines = fs.readFileSync(path, 'utf8').split('\n');
    lines.forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) process.env[match[1]] = match[2].replace(/["']/g, '');
    });
  }
}
parseEnv(envPath);
parseEnv(envLocalPath);

import { supabase } from './src/integrations/supabase/client';

async function check() {
  const { data: leads } = await supabase.from('leads').select('id, state').limit(5);
  console.log('Leads:', leads);

  const { data: cl } = await supabase.from('campaign_leads').select('id, lead_id, state').limit(5);
  console.log('Campaign Leads:', cl);
}
check();
