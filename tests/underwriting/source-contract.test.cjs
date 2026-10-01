const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'../..');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(f=>f.isDirectory()?files(path.join(dir,f.name)):[path.join(dir,f.name)]);}
const sources=files(path.join(root,'src/underwriting')).filter(f=>/\.tsx?$/.test(f)&&!f.includes('/__tests__/'));
const content=sources.map(f=>fs.readFileSync(f,'utf8')).join('\n');
test('feature has no production network or storage calls',()=>{
 for(const forbidden of [/\bfetch\s*\(/,/new\s+XMLHttpRequest/,/\bsendBeacon\s*\(/,/localStorage\s*\./,/sessionStorage\s*\./,/indexedDB\s*\./,/document\.cookie\s*=/,/console\.(log|error|warn)\s*\(/])assert.ok(!forbidden.test(content),String(forbidden));
});
test('feature contains no browser service-role or private-provider imports',()=>{
 for(const forbidden of ['SUPABASE_SERVICE_ROLE_KEY','TwilioContext','AuthContext','CalendarContext','NotificationContext','@supabase','@twilio'])assert.ok(!content.includes(forbidden),forbidden);
});
test('rendering never evaluates user HTML',()=>{assert.ok(!/\.innerHTML\s*=|insertAdjacentHTML|eval\s*\(|new Function/.test(content));});
test('React integration injects real Zod validation',()=>{const host=fs.readFileSync(path.join(root,'src/underwriting/UnderwritingPage.tsx'),'utf8');assert.match(host,/validateCase: validateWithZod/);assert.match(host,/scheduleSchema\.parse/);});
test('entry-point loads CRM only in the non-underwriting branch',()=>{const entry=fs.readFileSync(path.join(root,'src/main.tsx'),'utf8');assert.match(entry,/if \(isUnderwritingPath/);assert.match(entry,/else \{[\s\S]*import\('\.\/App\.tsx'\)/);assert.ok(!/import App from/.test(entry));});
test('route alias is anchored, not a catchall prefix',()=>{const route=fs.readFileSync(path.join(root,'src/underwriting/routing.ts'),'utf8');assert.ok(!route.includes('startsWith'));});
test('all UI modules remain under 200 lines',()=>{for(const f of sources.filter(f=>f.includes('/ui/')||f.endsWith('.tsx')))assert.ok(fs.readFileSync(f,'utf8').split('\n').length<200,path.basename(f));});
test('home navigation is a full document anchor',()=>{const view=fs.readFileSync(path.join(root,'src/underwriting/ui/mount.ts'),'utf8');assert.match(view,/brand.href='\/';/);});
