import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
export const settings = JSON.parse(readFileSync(process.env.AUTOMATIONS_LOCAL_SETTINGS, 'utf8'));
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(settings.API_URL)) throw Error('Local test API required');
for (const [key, role] of [['ANON_KEY', 'anon'], ['SERVICE_ROLE_KEY', 'service_role']]) {
  const payload = JSON.parse(Buffer.from(settings[key].split('.')[1], 'base64url'));
  if (payload.iss !== 'supabase-demo' || payload.role !== role) throw Error('Local fixture credentials required');
}
const db = settings.DB_CONTAINER;
const inspect = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
if (inspect('inspect', '-f', '{{index .Config.Labels "agentflow-test"}}', db) !== 'automations') throw Error('Fixture container required');
const net = inspect('inspect', '-f', '{{range $name, $conf := .NetworkSettings.Networks}}{{$name}}{{end}}', db);
if (inspect('network','inspect','-f','{{.Internal}}',net) !== 'true') throw Error('Isolated network required');
export function sql(statement) {
  return execFileSync('docker',['exec','-i','-e','PGPASSWORD',db,'psql','-XAtq','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{
    input:statement, encoding:'utf8',
  }).trim();
}
export const agency = 'ba921000-0000-4000-8000-000000000001';
export const otherAgency = 'ba921000-0000-4000-8000-000000000002';
export const sender = 'ba921000-0000-4000-8000-000000000010';
export const campaign = 'ba921000-0000-4000-8000-000000000011';
export const email = n => 'af-ui-'+n+'@example.invalid';
