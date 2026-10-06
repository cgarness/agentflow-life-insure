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
 assert.ok(await page.getByTitle('Send SMS').isDisabled());await page.getByLabel('Text purpose').first().selectOption('marketing');assert.ok(await page.getByTitle('Send SMS').isDisabled());
 await page.getByLabel('Text purpose').first().selectOption('informational');assert.ok(await page.getByTitle('Send SMS').isEnabled());await page.getByTitle('Send SMS').click();assert.equal(await page.getByPlaceholder('Type SMS message…').inputValue(),'Your requested appointment is tomorrow.');
 await page.getByRole('button',{name:'Simulate STOP'}).click();assert.ok(await page.getByTitle('Send SMS').isDisabled());
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'horizontal overflow');
 assert.deepEqual(errors,[]);await page.screenshot({path:`${evidence}/sms-${width}.png`,fullPage:true});console.log(`PASS ${width}x${height}: explicit purpose, blocked marketing, preserved draft, STOP, no overflow/errors`);await page.close();
}}finally{await browser.close();}
