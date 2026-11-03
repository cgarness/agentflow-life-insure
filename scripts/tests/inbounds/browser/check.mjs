import path from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../../../..');
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const server=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--config',path.join(here,'vite.config.mjs')],{stdio:['ignore','pipe','pipe']});
await new Promise((resolve,reject)=>{server.stdout.on('data',b=>{if(String(b).includes('Local:'))resolve();});server.on('error',reject);});
process.on('exit',()=>server.kill());
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
const page=await browser.newPage({viewport:{width:1440,height:1050}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:4176')?r.continue():r.abort());
await page.addInitScript(()=>{Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}});});
await page.goto('http://127.0.0.1:4176');await page.getByRole('button',{name:'Enter room'}).waitFor();
await page.getByRole('button',{name:'Enter room'}).click();await page.getByRole('heading',{name:'Ready for calls'}).waitFor();
await page.screenshot({path:'/tmp/inbounds-ui-ready.png',fullPage:true});
await page.locator('summary').filter({hasText:'Call script'}).click();assert.equal(await page.locator('#room-script').isVisible(),false);await page.locator('summary').filter({hasText:'Call script'}).click();
await page.evaluate(()=>window.demoRing());await page.getByRole('button',{name:'Answer call'}).click();await page.getByRole('heading',{name:'On a call',exact:true}).waitFor();
await page.getByRole('button',{name:'End call'}).click();await page.getByRole('heading',{name:'Finish this call'}).waitFor();
assert.equal(await page.getByRole('button',{name:'Start receiving'}).isDisabled(),true);
await page.screenshot({path:'/tmp/inbounds-ui-wrap.png',fullPage:true});
await page.getByLabel('Call outcome').selectOption('a3000000-0000-0000-0000-000000000001');await page.getByLabel('Notes (required)').fill('Requested a follow-up.');await page.getByRole('button',{name:'Save disposition'}).click();await page.getByRole('heading',{name:'Ready for calls'}).waitFor();
await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/inbounds-ui-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
assert.deepEqual(errors,[]);console.log('PASS: actual room components — join, collapsible scripts, receive/answer/end, mandatory wrap-up, save/unlock, responsive width; no external requests.');} finally { await browser.close(); server.kill(); }
