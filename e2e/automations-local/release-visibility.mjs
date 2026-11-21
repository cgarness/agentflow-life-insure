import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {settings} from './fixture.mjs';

export function runSqlFile(path,params) {
  return execFileSync('docker',['exec','-i','-e','PGPASSWORD',settings.DB_CONTAINER,'psql','-Xq','-v','ON_ERROR_STOP=1',
    '-U','postgres','-d','postgres',...Object.entries(params).flatMap(([k,v])=>['-v',k+'='+v]),'-f','-'],{
    input:readFileSync(path),stdio:['pipe','pipe','pipe'],encoding:'utf8',
  });
}
export function visibility(org, action, shouldRefuse=false) {
  assert.match(org,/^[a-f0-9-]{36}$/);
  assert.ok(['show','hide'].includes(action));
  const run = () => runSqlFile('supabase/ops/automations_builder_visibility.sql',{agency_id:org,action});
  if (shouldRefuse) assert.throws(run,e=>e.stderr.toString().includes('requires enrollment and sending to be off')); else run();
}
