import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';

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

const url = process.env.VITE_SUPABASE_URL || '';
const key = process.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = createClient(url, key);

async function check() {
  const { data: leads } = await supabase.from('leads').select('id, state').limit(5);
  console.log('Leads:', leads);

  const { data: cl } = await supabase.from('campaign_leads').select('id, lead_id, state').limit(5);
  console.log('Campaign Leads:', cl);
  process.exit(0);
}
check();
