// Browser acceptance of real components/hooks/API; synthetic transport and auth only.
// Run in isolated CI. Never uses hosted credentials, production forms, or actual publication.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output=process.env.UV_BROWSER_OUTPUT || '/tmp/uv-browser-evidence';
await mkdir(output,{recursive:true});
const canonical='https://www.underwriterverified.com/synthetic-agency/test-agent';
const origins=['http://127.0.0.1:4187','http://127.0.0.1:4188'];
const browser=await chromium.launch({headless:true});
const results=[];
try {
 for(const width of [1440,390]){
  let reads=0,writes=0,verified=false;
  const status={profile_id:'20000000-0000-4000-8000-000000000001',organization_id:'10000000-0000-4000-8000-000000000001',available:true,desired_published:false,phone_public:false,email_public:false,revision:'0',state:'private',public_url:null,last_synced_at:null};
  const row={name:'Test Agent',first_name:'Test',last_name:'Agent',agency:'Synthetic Agency',agency_slug:'synthetic-agency',slug:'test-agent',npn:'123456',phone:'',email:'',bio:'',short_bio:'',headshot_url:'',calendar_url:'#contact',state_licenses:['CA - #TEST'],testimonials:[],is_published:false};
  const context=await browser.newContext({viewport:{width,height:1000},permissions:['clipboard-read','clipboard-write']});
  row.contact_card_only=true;
  const errors=[],unexpected=[];
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(request.url()===canonical) return route.fulfill({status:302,headers:{location:origins[1]+'/synthetic-agency/test-agent'}});
   if(url.origin==='http://127.0.0.1:54321'){
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'}});
    const headers={'content-type':'application/json','access-control-allow-origin':'*'};
    if(url.pathname.endsWith('/rpc/get_my_uv_verification')){reads++;return route.fulfill({headers,body:JSON.stringify({status,verified})});}
    if(url.pathname.endsWith('/rpc/get_my_uv_setup')) return route.fulfill({headers,body:JSON.stringify({profile_id:status.profile_id,organization_id:status.organization_id,revision:status.revision,snapshot:'a'.repeat(32),draft:{first_name:'Test',last_name:'Agent',phone:'+15550001000',email:'synthetic@example.invalid',npn:'123456',avatar_url:'',bio:'',licenses:[{id:'30000000-0000-4000-8000-000000000001',state:'California',license_number:'TEST',expiration_date:null}]}})});
    if(url.pathname.endsWith('/rpc/complete_my_uv_setup')){
     const args=request.postDataJSON();assert.equal(args.p_expected_revision,status.revision);assert.equal(args.p_profile_id,status.profile_id);
     assert.equal(args.p_draft.licenses[0].expiration_date,null);assert.equal(args.p_draft.bio,'Helping families find the right coverage.');assert.ok(args.p_draft.avatar_url.startsWith('data:image/png;base64,'));
     writes++;status.state='pending';status.revision=String(Number(status.revision)+1);row.headshot_url=args.p_draft.avatar_url;row.bio=args.p_draft.bio;
     return route.fulfill({headers,body:JSON.stringify({status,verified:false})});
    }
    if(url.pathname.endsWith('/rpc/set_my_uv_profile')){
     writes++;const args=request.postDataJSON();
     assert.equal(args.p_profile_id,status.profile_id);assert.equal(args.p_organization_id,status.organization_id);assert.equal(args.p_expected_revision,status.revision);
     status.desired_published=args.p_published;status.phone_public=args.p_phone_public;status.email_public=args.p_email_public;
     status.revision=String(Number(status.revision)+1);status.state='pending';
     return route.fulfill({headers,body:JSON.stringify(status)});
    }
    if(url.pathname==='/rest/v1/agents'){
     assert.equal(url.searchParams.get('is_published'),'eq.true');
     const single=request.headers().accept?.includes('object');
     const value=row.is_published?(single?row:[row]):(single?null:[]);
     return route.fulfill({headers,body:JSON.stringify(value)});
    }
    throw Error('Unexpected synthetic backend request: '+url.pathname);
   }
   if(origins.includes(url.origin))return route.continue();
   if(['data:','blob:'].includes(url.protocol))return route.continue();
   unexpected.push(url.origin);return route.abort();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const profile=page.getByRole('region',{name:'Underwriter Verified public profile'});
  await page.goto(origins[0]);await profile.getByText('Private',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Edit public profile settings'}).click();
  const dialog=page.getByRole('dialog');
  for(const name of ['Publish profile','Show phone number','Show email'])assert.equal(await dialog.getByRole('checkbox',{name:new RegExp(name)}).isChecked(),false);
  await dialog.getByRole('checkbox',{name:'Publish profile',exact:true}).check();
  await dialog.getByRole('checkbox',{name:/Show phone number/}).check();
  await page.screenshot({path:output+'/'+width+'-choices.png',fullPage:true});
  await dialog.getByRole('button',{name:'Save',exact:true}).click();
  await profile.getByText('Syncing',{exact:true}).waitFor();
  assert.equal(status.email_public,false);assert.equal(status.phone_public,true);
  // Simulate the asynchronous acknowledgement; SQL/actual handlers are proven separately.
  row.is_published=true;row.phone='+15550001000';status.state='published';status.public_url=canonical;
  await page.reload();await profile.getByText('Published',{exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'View UV Page',exact:true}).getAttribute('href'),canonical);
  await page.getByRole('button',{name:'Copy Link',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Link copied'}).waitFor();
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),canonical);
  await page.getByRole('button',{name:'Agent Profile',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Edit public profile settings'}).count(),0);
  assert.equal(await page.getByRole('link',{name:'View UV Page',exact:true}).count(),1);
  assert.equal(await page.getByRole('button',{name:'Copy Link',exact:true}).count(),1);
  await page.screenshot({path:output+'/'+width+'-published.png',fullPage:true});
  const popupPromise=page.waitForEvent('popup');await page.getByRole('link',{name:'View UV Page',exact:true}).click();const publicPage=await popupPromise;
  publicPage.on('pageerror',e=>errors.push(e.message));
  await publicPage.getByRole('heading',{name:'Test Agent',exact:true}).waitFor();
  assert.equal(await publicPage.locator('a[href^="mailto:"]').count(),0);
  assert.ok(await publicPage.locator('a[href^="tel:"]').count()>0);
  assert.equal(await publicPage.getByText('Christopher Garness',{exact:false}).count(),0);
  assert.equal(await publicPage.getByText('What Families Are Saying',{exact:true}).count(),0);
  assert.equal(await publicPage.locator('img').count(),0); // neutral missing photo, never another agent
  assert.equal(await publicPage.locator('input,form,a[href^="sms:"]').count(),0);
  assert.equal(await publicPage.getByText('Agent Verified',{exact:false}).count(),0);
  assert.ok((await publicPage.title()).includes('Agent Profile'));
  await publicPage.evaluate(()=>document.fonts.ready);
  // Exercise real scroll reveals before capturing; a full-page screenshot does not scroll.
  for(const section of await publicPage.locator('section').all()){
   await section.scrollIntoViewIfNeeded();
   await publicPage.waitForTimeout(100); // IntersectionObserver and its reveal timer
   await publicPage.evaluate(()=>Promise.all(document.getAnimations()
    .filter(animation=>animation.effect?.getComputedTiming().iterations!==Infinity)
    .map(animation=>animation.finished.catch(()=>{}))));
  }
  await publicPage.evaluate(()=>scrollTo({top:0,left:0,behavior:'instant'}));
  await publicPage.waitForFunction(()=>scrollY===0);
  await publicPage.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.ok(await publicPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Public profile has no horizontal overflow');
  await publicPage.screenshot({path:output+'/'+width+'-uv.png',fullPage:true});
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Get verified',exact:true}).click();
  await dialog.getByLabel('First name',{exact:true}).waitFor();
  assert.equal(await dialog.getByLabel('First name',{exact:true}).inputValue(),'Test');
  await dialog.getByLabel('Profile photo',{exact:true}).setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
  await dialog.getByAltText('Profile preview').waitFor();
  await page.screenshot({path:output+'/'+width+'-wizard-profile.png',fullPage:true});
  await dialog.getByRole('button',{name:'Continue',exact:true}).click();
  await page.screenshot({path:output+'/'+width+'-wizard-licenses.png',fullPage:true});
  await dialog.getByRole('button',{name:'Continue',exact:true}).click();
  await dialog.getByRole('textbox',{name:/About you/}).fill('Helping families find the right coverage.');
  assert.equal(await dialog.getByRole('button',{name:'Confirm & get verified'}).isEnabled(),false);
  await dialog.getByRole('checkbox',{name:/I confirm/}).check();
  await page.screenshot({path:output+'/'+width+'-wizard-review.png',fullPage:true});
  await dialog.getByRole('button',{name:'Confirm & get verified'}).click();
  await dialog.getByRole('heading',{name:'Setting up your agent site'}).waitFor();
  assert.equal(await dialog.getByText('Your agent site is ready').count(),0);
  status.state='published';verified=true;row.profile_verified=true;
  await dialog.getByRole('heading',{name:'Your agent site is ready'}).waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Wizard has no horizontal overflow');
  await page.screenshot({path:output+'/'+width+'-wizard-complete.png',fullPage:true});
  await dialog.getByRole('button',{name:'Done',exact:true}).click();
  await page.getByRole('button',{name:'Agent Profile',exact:true}).click();
  await page.getByText('Verified',{exact:true}).waitFor();
  await page.screenshot({path:output+'/'+width+'-verified-actions.png',fullPage:true});
  await page.evaluate(()=>document.documentElement.classList.add('dark'));
  await page.screenshot({path:output+'/'+width+'-verified-actions-dark.png',fullPage:true});
  await page.evaluate(()=>document.documentElement.classList.remove('dark'));
  await publicPage.reload();await publicPage.getByLabel('Verified agent',{exact:true}).waitFor();
  await publicPage.getByText('Helping families find the right coverage.',{exact:true}).waitFor();
  assert.equal(await publicPage.locator('input,form,a[href^="sms:"]').count(),0);
  row.name='Updated Agent';row.first_name='Updated';row.npn='987654';row.state_licenses=['NY - #UPDATED'];
  row.headshot_url='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  await publicPage.reload();await publicPage.getByRole('heading',{name:'Updated Agent',exact:true}).waitFor();
  await publicPage.getByText(/^NPN:\s*987654$/).waitFor();await publicPage.getByText('NY - #UPDATED',{exact:true}).waitFor();
  assert.ok(await publicPage.locator('img').count()>0);
  row.phone='';row.email='updated@example.invalid';row.state_licenses=[];row.profile_verified=false;verified=false;
  await publicPage.reload();await publicPage.getByRole('link',{name:'Email',exact:true}).waitFor();
  assert.equal(await publicPage.locator('a[href^="tel:"]').count(),0);
  assert.equal(await publicPage.getByText('NY - #UPDATED',{exact:true}).count(),0);
  for(const route of ['bookcall','privacy-policy','terms-and-conditions']){
   await publicPage.goto(origins[1]+'/synthetic-agency/test-agent/'+route);
   await publicPage.getByRole('heading',{name:'Agent Not Found'}).waitFor();
   assert.equal(await publicPage.locator('form,input').count(),0);
  }
  await publicPage.goto(origins[1]);await publicPage.getByPlaceholder('Name, agency, phone, email, or NPN…').fill('Updated');
  await publicPage.getByRole('button',{name:'Search',exact:true}).click();await publicPage.getByText('Updated Agent',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  for(const mode of ['view','out']){
   const before=reads;await page.getByRole('button',{name:mode,exact:true}).click();
   assert.equal(await profile.count(),0);await page.waitForTimeout(100);assert.equal(reads,before);
  }
  await page.getByRole('button',{name:'self',exact:true}).click();await profile.waitFor();
  await page.getByRole('button',{name:'Edit public profile settings'}).click();
  await dialog.getByRole('checkbox',{name:'Publish profile',exact:true}).uncheck();await dialog.getByRole('button',{name:'Save',exact:true}).click();
  await profile.getByText('Syncing',{exact:true}).waitFor();
  row.is_published=false;status.state='private';
  await publicPage.goto(origins[1]+'/synthetic-agency/test-agent');await publicPage.getByRole('heading',{name:'Agent Not Found'}).waitFor();
  assert.equal(await publicPage.locator('a[href^="tel:"],a[href^="mailto:"]').count(),0);
  await publicPage.goto(origins[1]);await publicPage.getByPlaceholder('Name, agency, phone, email, or NPN…').fill('Updated');
  await publicPage.getByRole('button',{name:'Search',exact:true}).click();await publicPage.getByText('No agents found. Try a different search term.').waitFor();
  assert.equal(writes,3);assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  for(const p of [page,publicPage])assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');
  results.push({width,passed:true,reads,writes});await context.close();
 }
 await writeFile(output+'/summary.json',JSON.stringify({scope:'synthetic browser acceptance, not hosted integration',results},null,2));
 console.log('UV_BROWSER_ACCEPTANCE='+JSON.stringify(results));
}finally{await browser.close();}
