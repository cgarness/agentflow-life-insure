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
// AP is the only ranking metric: appointments, talk time, the ratio, the metric picker and rotation never show.
const REMOVED=/appointment|\bappts\b|talk time|\btalk\b|policies \/ 100|per 100 calls|viewing metric|auto-rotate|cycles metrics|1m 21s/i;
const CAPTION='Annual premium (2 policies with unknown premium) · Outside active roster: 2 calls, 0 policies';
// In-page helpers. The expected board is an independent AP comparator (AP, Policies, Calls, last/first name, id)
// over the fixture's rows, never the app's own ranking; the hard-coded orders below guard the comparator itself.
await page.addInitScript(()=>{
 window.__apExpected=()=>{
  if(!window.fixtureRows)return null;
  const rows=window.fixtureRows();const name=r=>`${r.last_name} ${r.first_name}`.toLowerCase();
  const ranked=[...rows].sort((a,b)=>b.premiumSold-a.premiumSold||b.policiesSold-a.policiesSold||b.callsMade-a.callsMade||name(a).localeCompare(name(b))||a.id.localeCompare(b.id));
  const usd=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
  const ap=r=>{const unknown=r.unknownPremiums??0;return (r.policiesSold>0&&unknown>=r.policiesSold?'—':usd(r.premiumSold))+(unknown>0?'*':'');};
  const sum=k=>rows.reduce((total,row)=>total+(row[k]??0),0);
  return {ranked:ranked.map((r,i)=>({id:r.id,rank:String(i+1),name:`${r.first_name} ${r.last_name[0]}.`,ap:ap(r),policies:String(r.policiesSold),calls:String(r.callsMade)})),
   podium:[ranked[1],ranked[0],ranked[2]].filter(Boolean).map(r=>r.id),
   totals:[sum('policiesSold')>0&&sum('unknownPremiums')>=sum('policiesSold')?'—':usd(sum('premiumSold')),String(sum('policiesSold'))]};
 };
 // Every rendered "Annual Premium" label that is clipped: wider than its own box, or cut off by an ancestor that hides
 // overflow, or pushed out sideways behind a scroll container (anything past one is reached by scrolling it).
 window.__labelClips=()=>{
  const found=[],clipped=[];
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  for(let node=walker.nextNode();node;node=walker.nextNode()){
   if(!node.textContent.includes('Annual Premium'))continue;
   const range=document.createRange();range.selectNodeContents(node);const r=range.getBoundingClientRect();
   if(!r.width)continue;
   const el=node.parentElement;found.push(node.textContent.trim());
   if(getComputedStyle(el).display==='inline'||el.scrollWidth>el.clientWidth)clipped.push(`${node.textContent.trim()}: ${el.scrollWidth} > ${el.clientWidth}`);
   for(let a=el.parentElement;a&&a!==document.body;a=a.parentElement){
    const style=getComputedStyle(a),b=a.getBoundingClientRect();
    const hidden=v=>v==='hidden'||v==='clip';
    const scrolls=[style.overflowX,style.overflowY].some(v=>v==='auto'||v==='scroll');
    if((hidden(style.overflowX)||scrolls)&&(r.left<b.left-1||r.right>b.right+1)||!scrolls&&hidden(style.overflowY)&&(r.top<b.top-1||r.bottom>b.bottom+1))
     clipped.push(`${node.textContent.trim()}: cut off by ${a.tagName.toLowerCase()}.${a.className}`);
    if(scrolls)break;
   }
  }
  return {found,clipped};
 };
 window.__tvTable=()=>{
  const container=document.querySelector('[data-testid="tv-rankings"] .divide-y');
  return [...(container?.children??[])].filter(row=>row.children.length===5).map(row=>({rank:row.children[0].querySelector('span')?.textContent,
   movement:row.children[0].querySelector('[title]')?.getAttribute('title')??null,name:row.children[1].lastElementChild?.textContent,
   ap:row.children[2].textContent,policies:row.children[3].textContent,calls:row.children[4].textContent}));
 };
 window.__tvDeep=()=>{
  const panel=[...document.querySelectorAll('h3')].find(h=>h.textContent.includes('Ranks 11+'))?.parentElement?.parentElement;
  return {text:panel?.textContent??'',rows:[...(panel?.querySelectorAll('li')??[])].map(li=>({rank:li.children[0].textContent,name:li.querySelector('p')?.textContent,ap:li.lastElementChild.textContent}))};
 };
 // Every difference between the TV on screen and the expected AP board; [] when they agree.
 window.__boardDiff=()=>{
  const e=window.__apExpected();if(!e)return ['fixture not ready'];const diff=[];
  const eq=(what,a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))diff.push(`${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);};
  const cards=[...document.querySelectorAll('[data-testid="tv-podium"] [data-agent-id]')];
  eq('podium',cards.map(c=>c.dataset.agentId),e.podium);
  for(const card of cards){const r=e.ranked.find(x=>x.id===card.dataset.agentId);
   for(const want of [`${r.ap}Annual Premium`,`${r.policies} Policies`,`${r.calls} Calls`])if(!card.textContent.includes(want))diff.push(`podium ${r.name} lacks "${want}"`);}
  eq('totals',[...document.querySelectorAll('[data-testid="tv-agency-totals"] .tabular-nums')].map(x=>x.textContent),e.totals);
  eq('total labels',[...document.querySelectorAll('[data-testid="tv-agency-totals"] .grid > div > p')].map(x=>x.textContent),['Annual Premium','Policies']);
  const header=document.querySelector('[data-testid="tv-rankings"] .divide-y')?.previousElementSibling;
  eq('table header',[...(header?.children??[])].map(x=>x.textContent),['Rank','Agent','Annual Premium','Policies','Calls']);
  if(!/Ranking · Annual Premium/.test(document.querySelector('[data-testid="tv-rankings"]')?.textContent??''))diff.push('table badge lacks "Ranking · Annual Premium"');
  if(!/Annual Premium/.test(window.__tvDeep().text))diff.push('ranks 11+ header lacks "Annual Premium"');
  const tableWant=e.ranked.slice(3,10);
  eq('ranks 4-10',window.__tvTable().map(({movement,...cells})=>cells),tableWant.map(({id,...cells})=>cells));
  if(!tableWant.length&&!/ALL AGENTS COMPETING ON THE PODIUM/.test(document.querySelector('[data-testid="tv-rankings"]').textContent))diff.push('empty table message');
  const deep=window.__tvDeep();
  eq('ranks 11+',deep.rows,e.ranked.slice(10).map(r=>({rank:r.rank,name:r.name,ap:r.ap})));
  if(!e.ranked.slice(10).length&&!deep.text.includes('No agents ranked 11+ yet'))diff.push('empty ranks 11+ message');
  return diff;
 };
});
async function assertBoard(label){
 await page.waitForFunction(()=>window.__boardDiff().length===0,null,{timeout:8000}).catch(()=>{});
 assert.deepEqual(await page.evaluate(()=>window.__boardDiff()),[],`${label}: TV board must match the AP ranking`);
 const text=await page.locator('body').innerText();
 assert.doesNotMatch(text,REMOVED,`${label}: removed metrics on screen`);
 assert.doesNotMatch(text,/\bAP\b|Annualized/,`${label}: premium is labelled "Annual Premium"`);
}
const tvNames=()=>page.evaluate(()=>window.__tvTable().map(r=>r.name));
const tvMovements=()=>page.evaluate(()=>Object.fromEntries(window.__tvTable().filter(r=>r.movement).map(r=>[r.name,r.movement])));
const podiumIds=()=>page.getByTestId('tv-podium').locator('[data-agent-id]').evaluateAll(es=>es.map(e=>e.dataset.agentId));
try {
 await page.goto(url);
 await page.getByTestId('tv-podium').waitFor();
 assert.equal(await page.locator('vite-error-overlay').count(),0);
 // Material-only notes: 2 unknown premiums and activity outside the roster; excluded appointments never appear.
 assert.equal(await page.locator('[data-testid="tv-agency-totals"] > p').textContent(),CAPTION);
 assert.doesNotMatch(await page.locator('body').innerText(),/Active agents · |As of |Stored call duration|unknown provenance/);
 // The fixture signs in as an Agent: the options popover holds only the org-wide ticker editor, so no gear.
 assert.equal(await page.getByRole('button',{name:'TV display options'}).count(),0,'Agent sees no TV settings gear');
 // Recent Wins show the Sold Date distinctly from the entry; a clock time is only ever labelled as the entry.
 async function assertSoldDateRows(where) {
  const text=await page.locator('body').innerText();
  assert.match(text,/Sold 10\/15\/2026\s*·\s*Entered 10\/16\/2026/,`${where}: late entry keeps its Sold Date`);
  assert.match(text,/Sold 10\/16\/2026\s*·\s*Entered \d{1,2}:\d{2} [AP]M/,`${where}: same-day entry shows its entry time`);
  assert.match(text,/Sold date unknown\s*·\s*Entered 10\/16\/2026/,`${where}: unknown Sold Date is said, never inferred`);
  assert.doesNotMatch(text,/Sold [^·\n]*\d{1,2}:\d{2}/,`${where}: no time of sale`);
 }
 await assertSoldDateRows('TV');
 async function settleLayout() {
  await page.evaluate(async()=>{
   let previous='',stableSince=performance.now();const deadline=performance.now()+6000;
   while(performance.now()<deadline){
    await new Promise(requestAnimationFrame);
    const positions=JSON.stringify([...document.querySelectorAll('[data-testid="tv-rankings"], [data-testid="tv-rankings"] img, [data-testid="tv-podium"] [data-agent-id]')].map(e=>{
     const r=e.getBoundingClientRect();return [e.getAttribute('data-agent-id'),r.x,r.y,r.width,r.height].map(v=>typeof v==='number'?Math.round(v*10):v);
    }));
    if(positions!==previous){previous=positions;stableSince=performance.now();}
    if(performance.now()-stableSince>400)return;
   }
   throw new Error('TV layout did not settle');
  });
 }
 async function measure(label) {
  await page.waitForFunction(()=>{
   const expected=window.__apExpected();if(!expected)return false;
   const ids=[...document.querySelectorAll('[data-testid="tv-podium"] [data-agent-id]')].map(e=>e.dataset.agentId);
   const totals=[...document.querySelectorAll('[data-testid="tv-agency-totals"] .tabular-nums')].map(e=>e.textContent);
   return JSON.stringify(ids)===JSON.stringify(expected.podium)&&JSON.stringify(totals)===JSON.stringify(expected.totals);
  });
  await page.waitForFunction(()=>{const photos=[...document.querySelectorAll('[data-testid="tv-podium"] img')];return photos.length===document.querySelectorAll('[data-testid="tv-podium"] [data-agent-id]').length&&photos.every(i=>i.complete&&i.naturalWidth>0);});
  await settleLayout();
  const metrics=await page.evaluate(()=>{
   const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};};
   const totals=rect(document.querySelector('[data-testid="tv-agency-totals"]'));
   const podium=rect(document.querySelector('[data-testid="tv-podium"]'));
   const cards=[...document.querySelectorAll('[data-testid="tv-podium"] [data-agent-id]')].map(rect);
   const photos=[...document.querySelectorAll('[data-testid="tv-podium"] img,[data-testid="tv-rankings"] img')].map(rect);
   const table=document.querySelector('[data-testid="tv-rankings"]');
   const tablePhotos=[...table.querySelectorAll('img')].map(rect);
   const panels=[...document.querySelector('[data-testid="tv-lower-panels"]').children].map(rect);
   const totalCells=[...document.querySelectorAll('[data-testid="tv-agency-totals"] .grid > div')].map(rect);
   const totalsRow=rect(document.querySelector('[data-testid="tv-agency-totals"] .grid'));
   return {totalsRow,centerError:Math.abs(totals.x+totals.w/2-podium.x-podium.w/2),cards,photos,panels,table:rect(table),tablePhotos,totalCells,labels:window.__labelClips(),
    horizontalOverflow:document.documentElement.scrollWidth>window.innerWidth,originalRanks:window.fixtureRanks()};
  });
  assert.ok(metrics.centerError<1,`${label}: podium and Agency Totals centerline`);
  assert.equal(metrics.horizontalOverflow,false,`${label}: horizontal page overflow`);
  // Two totals cells (Annual Premium, Policies) side by side with equal widths, together filling the strip's row.
  const [premiumCell,policiesCell]=metrics.totalCells,row=metrics.totalsRow;
  assert.equal(metrics.totalCells.length,2,`${label}: two totals cells`);
  assert.ok(Math.abs(premiumCell.y-policiesCell.y)<1&&premiumCell.right<=policiesCell.x+1&&Math.abs(premiumCell.w-policiesCell.w)<1&&
   Math.abs(premiumCell.x-row.x)<1&&Math.abs(policiesCell.right-row.right)<1,
   `${label}: totals cells side by side with equal widths: ${JSON.stringify({row,cells:metrics.totalCells})}`);
  // Every label on screen: badge, ranks 4-10 and 11+ headers, totals and one per podium card.
  assert.equal(metrics.labels.found.length,4+metrics.cards.length,`${label}: Annual Premium labels ${JSON.stringify(metrics.labels.found)}`);
  assert.deepEqual(metrics.labels.clipped,[],`${label}: clipped Annual Premium labels`);
  for(let i=0;i<metrics.panels.length;i++)for(let j=i+1;j<metrics.panels.length;j++) {
   const a=metrics.panels[i],b=metrics.panels[j];
   assert.ok(a.right<=b.x+1||b.right<=a.x+1||a.bottom<=b.y+1||b.bottom<=a.y+1,`${label}: lower panels overlap ${i}/${j}: ${JSON.stringify(metrics.panels)}`);
  }
  for(let i=0;i<metrics.photos.length;i++)for(let j=i+1;j<metrics.photos.length;j++) {
   const a=metrics.photos[i],b=metrics.photos[j];
   assert.ok(a.right<=b.x+1||b.right<=a.x+1||a.bottom<=b.y+1||b.bottom<=a.y+1,`${label}: overlapping avatars ${i}/${j}`);
  }
  assert.ok(metrics.tablePhotos.every(p=>p.bottom<=metrics.table.bottom+1),`${label}: table clips photos`);
  assert.ok(metrics.originalRanks.every((r,i)=>r===i+1),`${label}: mutated source ranks`);
  await assertBoard(label);
  await page.screenshot({path:`${output}/${label}.png`});
  await page.getByTestId('tv-rankings').scrollIntoViewIfNeeded();
  await settleLayout();
  const visiblePhotos=await page.getByTestId('tv-rankings').locator('img').evaluateAll(images=>images.map(img=>{
   const r=img.getBoundingClientRect();const main=document.querySelector('main').getBoundingClientRect();
   const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
   return {visible:r.top>=main.top-1&&r.bottom<=main.bottom+1&&hit===img,top:r.top,bottom:r.bottom,mainTop:main.top,mainBottom:main.bottom,hit:hit?.tagName};
  }));
  assert.ok(visiblePhotos.every(p=>p.visible),`${label}: table photos must be visible after scrolling: ${JSON.stringify(visiblePhotos)}`);
  await page.screenshot({path:`${output}/${label}-table.png`});
  await page.locator('main').evaluate(main=>main.scrollTo({top:0}));
  await settleLayout();
  console.log('PASS',label,JSON.stringify({centerError:metrics.centerError,photos:metrics.photos.length}));
 }
 for(const [w,h] of [[1366,768],[1920,1080],[3840,2160],[1093,614]]) {
  await page.setViewportSize({width:w,height:h});
  await measure(`${w}x${h}`);
 }
 // Deterministic AP tie-breaks, both decided against name order: Harper ties Gray on AP with one more Policy;
 // Jordan ties Indigo on AP and Policies with more Calls. Noah's only premium is unknown: "—*", never $0, ranked last.
 await page.setViewportSize({width:1920,height:1080});
 assert.deepEqual(await podiumIds(),['fixture-2','fixture-1','fixture-3'],'podium by AP');
 assert.deepEqual(await tvNames(),['Emerson T.','Finley T.','Harper T.','Gray T.','Jordan T.','Indigo T.','Kai T.'],'ranks 4-10 by AP with tie-breaks');
 assert.deepEqual((await page.evaluate(()=>window.__tvDeep().rows)).map(r=>[r.rank,r.name,r.ap]),
  [['11','Logan T.','$5,571.36'],['12','Morgan T.','$3,714.24'],['13','Avery T.','$701.40*'],['14','Noah T.','—*']],'ranks 11+ by AP');
 assert.deepEqual(await tvMovements(),{},'no movement without a rank change');
 await page.getByRole('tab',{name:'Month',exact:true}).click();
 await measure('period-switch');
 for(const count of [1,2,3,14]) {
  await page.evaluate(n=>window.fixtureSetCount(n),count);
  await page.waitForFunction(n=>document.querySelectorAll('[data-testid="tv-podium"] [data-agent-id]').length===Math.min(n,3),count);
  await measure(`roster-${count}`);
 }
 // A new value that keeps every rank: totals change, no movement indicator.
 await page.evaluate(()=>window.fixtureLiveUpdate());
 await page.waitForFunction(()=>window.__boardDiff().length===0);
 assert.deepEqual(await tvMovements(),{},'a value change that keeps every rank shows no movement');
 await measure('live-policy-update');
 // A Policies tie-break reorder (equal AP) is a real rank change and shows as movement.
 await page.evaluate(()=>window.fixtureTieBreakUpdate());
 await page.waitForFunction(()=>window.__tvTable().filter(r=>r.movement).length===2,null,{timeout:2500});
 assert.deepEqual(await tvMovements(),{'Gray T.':'Moved up 1 spot since the last leaderboard update','Harper T.':'Moved down 1 spot since the last leaderboard update'},'tie-break movement');
 await measure('live-tiebreak-reorder');
 assert.deepEqual(await tvNames(),['Emerson T.','Finley T.','Gray T.','Harper T.','Jordan T.','Indigo T.','Kai T.'],'Gray overtakes Harper on Policies');
 // An AP reorder: Kai to #1; everyone it passes moves down one.
 await page.evaluate(()=>window.fixtureApUpdate());
 await page.waitForFunction(()=>window.__tvTable().filter(r=>r.movement).length===7,null,{timeout:2500});
 const down=Object.values(await tvMovements());
 assert.deepEqual(down,Array(7).fill('Moved down 1 spot since the last leaderboard update'),'AP reorder movement');
 await measure('live-ap-reorder');
 assert.deepEqual(await podiumIds(),['fixture-1','fixture-10','fixture-2'],'Kai leads by AP');
 // The removed metric selector and auto-rotation left stored preferences behind: TV ignores and removes them.
 await page.evaluate(()=>{localStorage.setItem('leaderboardTvMetricIndex','1');localStorage.setItem('leaderboardTvAutoRotate','1');});
 await page.getByRole('button',{name:'Exit TV mode'}).click();
 await page.getByRole('button',{name:'Enter TV mode'}).click();
 await measure('reentered-tv');
 assert.deepEqual(await page.evaluate(()=>[localStorage.getItem('leaderboardTvMetricIndex'),localStorage.getItem('leaderboardTvAutoRotate')]),[null,null],'obsolete TV preferences removed');
 // Real browser timers: past the former 30-second rotation interval the AP board is unchanged.
 const board=async()=>({podium:await page.getByTestId('tv-podium').innerText(),table:await tvNames(),deep:await page.evaluate(()=>window.__tvDeep().rows),totals:await page.locator('[data-testid="tv-agency-totals"] .tabular-nums').allTextContents()});
 const before=await board();
 await page.waitForTimeout(30_100);
 assert.deepEqual(await board(),before,'TV rankings unchanged after the former 30-second rotation interval');
 await assertBoard('after-30s');
 await page.goto(`${url}/?view=normal`);
 await page.setViewportSize({width:1440,height:1000});
 await page.getByText('$701.40',{exact:true}).waitFor();
 assert.equal(await page.getByText(CAPTION,{exact:true}).count(),1,'normal standings caption');
 // Full Rankings: every ranked agent in AP order, five columns, the signed-in agent's YOU row.
 const normal=await page.evaluate(()=>({expected:window.__apExpected().ranked,
  headers:[...document.querySelectorAll('[role="columnheader"]')].map(h=>h.textContent),
  rows:[...document.querySelectorAll('[role="rowgroup"] [role="row"]')].map(row=>{const c=[...row.querySelectorAll('[role="cell"]')];
   return {rank:c[0].querySelector('span').textContent,name:c[1].querySelector('span[title]').textContent,ap:c[2].textContent,policies:c[3].textContent,calls:c[4].textContent,
    you:/You/.test(c[1].textContent),current:row.getAttribute('aria-current')};})}));
 assert.deepEqual(normal.headers,['Rank','Agent','Annual Premium','Policies','Calls'],'Full Rankings columns');
 assert.equal(await page.getByRole('table',{name:'Full rankings by Annual Premium'}).count(),1,'Full Rankings accessible name');
 assert.deepEqual(normal.rows.map(({you,current,...cells})=>cells),normal.expected.map(({id,...cells})=>cells),'Full Rankings AP order and cells');
 assert.deepEqual(normal.rows.filter(r=>r.you).map(r=>[r.name,r.rank,r.current]),[['Gray T.','7','true']],'one YOU row, mid-table');
 assert.ok(normal.rows.some(r=>r.ap==='—*'),'all-unknown premium reads —, never $0');
 for(const [width,height] of [[1440,1000],[390,844]]){
  await page.setViewportSize({width,height});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'normal standings horizontal overflow');
  // The Annual Premium header fits (two lines on phones) and no column hides behind the table's sideways scroll.
  const fit=await page.evaluate(()=>{const wrap=document.querySelector('[role="table"]').parentElement;
   return {labels:window.__labelClips(),hiddenColumns:wrap.scrollWidth>wrap.clientWidth};});
  assert.deepEqual(fit.labels.found,['Annual Premium'],`normal-${width}: one Annual Premium header`);
  assert.deepEqual(fit.labels.clipped,[],`normal-${width}: clipped Annual Premium header`);
  assert.equal(fit.hiddenColumns,false,`normal-${width}: Full Rankings columns hidden behind scroll`);
  assert.doesNotMatch(await page.locator('body').innerText(),/\bAP\b|Annualized/,`normal-${width}: premium is labelled "Annual Premium"`);
  assert.doesNotMatch(await page.locator('body').innerText(),REMOVED,`normal-${width}: removed metrics on screen`);
  await assertSoldDateRows(`normal-${width}`);
  await page.screenshot({path:`${output}/normal-${width}.png`});
 }
 // Routine snapshot (?routine=1): no caption line in the totals wrapper; the same geometry and AP checks hold.
 await page.goto(`${url}/?routine=1`);
 await page.setViewportSize({width:1366,height:768});
 await page.getByTestId('tv-podium').waitFor();
 assert.equal(await page.locator('[data-testid="tv-agency-totals"] > p').count(),0,'routine snapshot: no caption line above the totals');
 assert.doesNotMatch(await page.locator('body').innerText(),/policies with unknown premium|Talk time includes|Outside active roster|Active agents · |As of /);
 await measure('routine-1366x768');
 // Admin: the same stub module served with role "Admin" to a separate browser context (no file or network change).
 const adminContext=await browser.newContext({viewport:{width:1920,height:1080}});
 const admin=await adminContext.newPage();
 admin.on('pageerror',e=>errors.push(`admin: ${e.message}`));
 let swapped=0;
 await admin.route(target=>target.pathname.endsWith('/stubs.ts'),async route=>{
  const response=await route.fetch();
  const body=(await response.text()).replace(/role:\s*"Agent"/,()=>{swapped++;return 'role: "Admin"';});
  await route.fulfill({response,body});
 });
 await admin.goto(url);
 await admin.getByTestId('tv-podium').waitFor();
 assert.equal(swapped,1,'admin context loaded the Admin stub');
 await admin.getByRole('button',{name:'TV display options'}).click();
 const editor=admin.getByLabel('Scrolling ticker (org-wide)');
 await editor.waitFor();
 assert.equal(await admin.getByLabel('Viewing metric').count(),0,'no metric selector');
 assert.equal(await admin.getByRole('switch').count(),0,'no auto-rotate switch');
 assert.equal(await admin.getByRole('combobox').count(),0,'no select');
 const save=admin.getByRole('button',{name:'Save',exact:true});
 assert.equal(await save.isDisabled(),true,'Save waits for a change');
 await editor.fill('Fixture ticker message');
 assert.equal(await save.isEnabled(),true,'an edited ticker can be saved');
 await admin.getByRole('button',{name:'Reset',exact:true}).click();
 assert.equal(await editor.inputValue(),'','Reset restores the saved ticker');
 assert.equal(await save.isDisabled(),true,'nothing to save after Reset');
 await editor.fill('Fixture ticker message');
 await admin.screenshot({path:`${output}/admin-ticker-settings.png`});
 await admin.keyboard.press('Escape');
 await admin.getByLabel('Scrolling ticker (org-wide)').waitFor({state:'detached'});
 assert.equal(await admin.getByTestId('tv-podium').count(),1,'Escape closes the options, not TV');
 await admin.keyboard.press('Escape');
 await admin.getByRole('button',{name:'Enter TV mode'}).waitFor();
 assert.doesNotMatch(await admin.locator('body').innerText(),REMOVED,'admin: removed metrics on screen');
 await adminContext.close();
 assert.deepEqual(errors,[],'browser console errors');
 console.log('PASS TV layout, AP ranking and tie-breaks, movement, period switch, roster sizes, entry/exit, no rotation, Admin ticker settings, normal standings and routine-caption checks');
} catch(error) {
 console.error('Browser errors:',JSON.stringify(errors));
 console.error('Visible state:',(await page.locator('body').innerText()).slice(0,4000));
 await page.screenshot({path:`${output}/failure.png`});
 throw error;
} finally {await browser.close();}
