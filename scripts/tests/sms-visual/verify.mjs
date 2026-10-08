import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.SMS_PLAYWRIGHT_MODULE).href);
const evidence=process.env.SMS_VISUAL_EVIDENCE || '/tmp/sms-visual-evidence';
await mkdir(evidence,{recursive:true});
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
try {for(const [width,height] of [[1440,900],[390,844]]){
 const page=await browser.newPage({viewport:{width,height}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4188',{waitUntil:'networkidle'});
 const composer=page.getByRole('region',{name:'Manual composer'});
 assert.equal(await composer.getByLabel('Text purpose').count(),0);assert.equal(await composer.getByText(/Informational:|Marketing:|Choose a text purpose|Refresh/).count(),0);
 assert.ok(await page.getByTitle('Send SMS').isEnabled());await page.getByTitle('Send SMS').click();assert.equal(await page.getByPlaceholder('Type SMS message…').inputValue(),'Your requested appointment is tomorrow.');
 await page.getByRole('button',{name:'Simulate STOP'}).click();await page.getByTitle('Send SMS').click();assert.equal(await page.getByRole('status').textContent(),'Synthetic server: recipient opted out.');assert.equal(await page.getByPlaceholder('Type SMS message…').inputValue(),'Your requested appointment is tomorrow.');
 assert.equal(await page.getByLabel('Text purpose').count(),1,'workflow purpose remains separate');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'horizontal overflow');
 assert.deepEqual(errors,[]);await page.screenshot({path:`${evidence}/sms-${width}.png`,fullPage:true});console.log(`PASS ${width}x${height}: manual composer has no purpose/readiness prose; failed drafts preserved; workflow purpose remains; no overflow/errors`);await page.close();
}}finally{await browser.close();}
