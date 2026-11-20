if(Deno.env.get('SUPABASE_URL')!=='http://127.0.0.1:55475')throw Error('Isolated gateway required');
const original=fetch;globalThis.fetch=async(input,init)=>{const u=typeof input==='string'?input:input instanceof URL?input.href:input.url;
 if(u.startsWith('http://127.0.0.1:55475/'))return original(input,init);
 if(u.startsWith('https://api.twilio.com/')&&u.endsWith('/Messages.json'))return Response.json({sid:'SM'+crypto.randomUUID().replaceAll('-',''),status:'queued'});
 if(u.startsWith('https://api.twilio.com/')||u.startsWith('https://messaging.twilio.com/'))return Response.json({sid:u.match(/PN[0-9a-f]{32}/i)?.[0],account_sid:'AC00000000000000000000000000000001',service_sid:'MG00000000000000000000000000000001',capabilities:{sms:true}});
 throw Error('Unexpected external transport refused');};
const serve=Deno.serve;Object.defineProperty(Deno,'serve',{value:(handler:Deno.ServeHandler)=>serve({hostname:'127.0.0.1',port:55476},handler)});
await import('../../supabase/functions/twilio-sms/index.ts');
