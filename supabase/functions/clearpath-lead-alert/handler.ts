import { boundedBody, json, SmsError, UUID, failure } from '../_shared/sms/wire.ts';

export const PATH = '/functions/v1/clearpath-lead-alert';
export const TEST_ID = 'd8c26ad5-e53d-4780-9fd4-78567264c004';
export const PUBLIC_KEY = { kty: 'OKP', crv: 'Ed25519', x: 'WPwXv8IluOp9WRSjgKedDNNdurhbnQvcb1W_7kSKFPc' };
export type Alert = { id: string; action: 'send' | 'status'; kind: 'lead' | 'test' };
export function signedContent(time: string, body: string) {
  return new TextEncoder().encode(`clearpath-alert-v1\nPOST\n${PATH}\n${time}\n${body}`);
}
export async function handle(req: Request, run: (a: Alert) => Promise<unknown>, publicKey = PUBLIC_KEY) {
  try {
    const url = new URL(req.url), time = req.headers.get('x-alert-time') ?? '';
    if (req.method !== 'POST' || ![PATH, '/clearpath-lead-alert'].includes(url.pathname) || url.search || !/^\d{10}$/.test(time) || Math.abs(Date.now()/1000-Number(time))>60) throw new SmsError('ALERT_AUTH','Unauthorized',403);
    const body = await boundedBody(req, 512);
    const encoded = req.headers.get('x-alert-signature') ?? '';
    if (!/^[A-Za-z0-9+/]{86}==$/.test(encoded)) throw new SmsError('ALERT_AUTH','Unauthorized',403);
    const key = await crypto.subtle.importKey('jwk',publicKey,{name:'Ed25519'},false,['verify']);
    const signature = Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
    if (!await crypto.subtle.verify('Ed25519',key,signature,signedContent(time,body))) throw new SmsError('ALERT_AUTH','Unauthorized',403);
    let a: Alert;
    try { a=JSON.parse(body); } catch { throw new SmsError('ALERT_INPUT','Invalid request',400); }
    if (!a || Object.keys(a).sort().join(',')!=='action,id,kind' || !UUID.test(a.id) || !['send','status'].includes(a.action) || !['lead','test'].includes(a.kind) || (a.kind==='test')!==(a.id===TEST_ID)) throw new SmsError('ALERT_INPUT','Invalid request',400);
    return json(await run(a));
  } catch(e) { return failure(e); }
}
