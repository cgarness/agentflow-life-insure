// Run against the isolated fixture only; no production auth or network data.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url=process.env.LEADERBOARD_VISUAL_URL || 'http://127.0.0.1:4179';
assert.equal(new URL(url).hostname,'127.0.0.1','Only the isolated localhost fixture is allowed');
const output=process.env.LEADERBOARD_VISUAL_OUTPUT || 'docs/plans/2026-10-03-leaderboard-data-tv/visual-evidence';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const page=await browser.newPage();
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
try {
 await page.goto(url);
 await page.getByTestId('tv-podium').waitFor();
 assert.equal(await page.locator('vite-error-overlay').count(),0);
 async function measure(label) {
  await page.waitForFunction(()=>{const photos=[...document.querySelectorAll('[data-testid="tv-podium"] img')];return photos.length===document.querySelectorAll('[data-testid="tv-podium"] [data-agent-id]').length&&photos.every(i=>i.complete&&i.naturalWidth>0);});
  const metrics=await page.evaluate(()=>{
   const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};};
   const totals=rect(document.querySelector('[data-testid="tv-agency-totals"]'));
   const podium=rect(document.querySelector('[data-testid="tv-podium"]'));
   const cards=[...document.querySelectorAll('[data-testid="tv-podium"] [data-agent-id]')].map(rect);
   const photos=[...document.querySelectorAll('[data-testid="tv-podium"] img,[data-testid="tv-rankings"] img')].map(rect);
   const table=document.querySelector('[data-testid="tv-rankings"]');
   const tablePhotos=[...table.querySelectorAll('img')].map(rect);
   return {centerError:Math.abs(totals.x+totals.w/2-podium.x-podium.w/2),cards,photos,table:rect(table),tablePhotos,
    horizontalOverflow:document.documentElement.scrollWidth>window.innerWidth,originalRanks:window.fixtureRanks()};
  });
  assert.ok(metrics.centerError<1,`${label}: podium and Agency Totals centerline`);
  assert.equal(metrics.horizontalOverflow,false,`${label}: horizontal page overflow`);
  for(let i=0;i<metrics.photos.length;i++)for(let j=i+1;j<metrics.photos.length;j++) {
   const a=metrics.photos[i],b=metrics.photos[j];
   assert.ok(a.right<=b.x+1||b.right<=a.x+1||a.bottom<=b.y+1||b.bottom<=a.y+1,`${label}: overlapping avatars ${i}/${j}`);
  }
  assert.ok(metrics.tablePhotos.every(p=>p.bottom<=metrics.table.bottom+1),`${label}: table clips photos`);
  assert.ok(metrics.originalRanks.every((r,i)=>r===i+1),`${label}: mutated source ranks`);
  await page.screenshot({path:`${output}/${label}.png`});
  console.log('PASS',label,JSON.stringify({centerError:metrics.centerError,photos:metrics.photos.length}));
 }
 for(const [w,h] of [[1366,768],[1920,1080],[3840,2160],[1093,614]]) {
  await page.setViewportSize({width:w,height:h});
  await measure(`${w}x${h}`);
 }
 await page.setViewportSize({width:1920,height:1080});
 await page.getByRole('button',{name:'TV display options'}).click();
 await page.getByRole('switch',{name:'Auto-rotate stats'}).click();
 await page.getByLabel('Viewing metric').selectOption('1');
 await page.keyboard.press('Escape');
 assert.deepEqual(await page.getByTestId('tv-podium').locator('[data-agent-id]').evaluateAll(es=>es.map(e=>e.dataset.agentId)),['fixture-12','fixture-13','fixture-11']);
 await measure('calls-manual-switch');
 await page.getByRole('button',{name:'Month',exact:true}).click();
 await measure('period-switch');
 for(const count of [1,2,3,14]) {
  await page.evaluate(n=>window.fixtureSetCount(n),count);
  await page.waitForFunction(n=>document.querySelectorAll('[data-testid="tv-podium"] [data-agent-id]').length===Math.min(n,3),count);
  await measure(`roster-${count}`);
 }
 await page.getByRole('button',{name:'Exit TV mode'}).click();
 await page.getByRole('button',{name:'Enter TV mode'}).click();
 await measure('reentered-tv');
 // Real browser timer handling; no network standings fetch is involved in rotation.
 await page.getByRole('button',{name:'TV display options'}).click();
 await page.getByRole('switch',{name:'Auto-rotate stats'}).click();
 await page.keyboard.press('Escape');
 const prior=await page.getByTestId('tv-podium').innerText();
 await page.waitForTimeout(30_100);
 assert.notEqual(await page.getByTestId('tv-podium').innerText(),prior,'automatic metric rotation');
 assert.deepEqual(errors,[],'browser console errors');
 console.log('PASS TV layout, metric/period switches, roster sizes, entry/exit and timer checks');
} finally {await browser.close();}
