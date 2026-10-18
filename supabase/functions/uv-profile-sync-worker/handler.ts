import { equalSecret, json, PUBLIC_PROFILE_URL, readBoundedText, record, sign, UUID, type Rpc } from '../_shared/uv-profile/protocol.ts';
import { parseEnvelope, type ProfileEnvelope } from '../_shared/uv-profile/payload.ts';

export const RECEIVER_URL = 'https://jzdzeevjpootbeuniygx.supabase.co/functions/v1/agentflow-profile-sync';
type Job = { organization_id: string; profile_id: string; lease_token: string };
type Options = { enabled: boolean; workerSecret: string; syncSecret: string; rpc: Rpc; fetch: typeof fetch };
const errors = new Set(['invalid_profile','temporarily_unavailable','link_required','configuration_required','version_conflict','invalid_receipt']);
async function call(rpc: Rpc, name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await rpc(name,args);
  if (result.error) throw new Error('temporarily_unavailable');
  return result.data;
}
function args(job: Job) {
  return { p_organization_id: job.organization_id, p_profile_id: job.profile_id, p_lease_token: job.lease_token };
}
function isJob(value: unknown): value is Job {
  return record(value) && ['organization_id','profile_id','lease_token'].every(k => typeof value[k] === 'string' && UUID.test(value[k] as string));
}
function receipt(value: unknown, envelope: ProfileEnvelope) {
  if (!record(value) || value.version !== envelope.version || value.published !== envelope.profile.published
    || (value.warning !== null && value.warning !== 'identity_review_required')
    || (value.public_url !== null && (typeof value.public_url !== 'string' || !PUBLIC_PROFILE_URL.test(value.public_url)))
    || (value.published && value.public_url === null)) throw new Error('invalid_receipt');
  return { version: value.version, published: value.published, warning: value.warning, public_url: value.public_url };
}
async function deliver(job: Job, options: Options): Promise<'synced'|'unchanged'|'failed'|'superseded'> {
  let envelope: ProfileEnvelope | undefined;
  let invalidProfile = false;
  try {
    let prepared = await call(options.rpc,'prepare_uv_profile_sync',{ ...args(job), p_force_private: false });
    if (prepared === null) return 'superseded';
    if (!record(prepared) || typeof prepared.needs_delivery !== 'boolean') throw new Error('temporarily_unavailable');
    try { envelope = parseEnvelope(prepared.envelope); }
    catch {
      // Invalid source data must not leave previously shared contact details public.
      invalidProfile = true;
      prepared = await call(options.rpc,'prepare_uv_profile_sync',{ ...args(job), p_force_private: true });
      if (prepared === null) return 'superseded';
      if (!record(prepared) || typeof prepared.needs_delivery !== 'boolean') throw new Error('temporarily_unavailable');
      envelope = parseEnvelope(prepared.envelope);
    }
    if (envelope.organization_id !== job.organization_id || envelope.profile_id !== job.profile_id) throw new Error('temporarily_unavailable');
    let ack: unknown = null;
    if ((prepared as Record<string,unknown>).needs_delivery) {
      const body = JSON.stringify(envelope);
      const timestamp = Math.floor(Date.now()/1000).toString();
      const nonce = crypto.randomUUID();
      const signature = await sign(body,options.syncSecret,timestamp,nonce);
      const response = await options.fetch(RECEIVER_URL,{ method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000), body,
        headers: { 'content-type':'application/json','x-uv-timestamp':timestamp,'x-uv-nonce':nonce,'x-uv-signature':signature } });
      const data: unknown = JSON.parse(await readBoundedText(response.body,8192));
      if (!response.ok) throw new Error(record(data) && typeof data.error === 'string' && errors.has(data.error) ? data.error : 'temporarily_unavailable');
      ack = receipt(data,envelope);
    }
    const finished = await call(options.rpc,'finish_uv_profile_sync',{ ...args(job), p_version:envelope.version,
      p_receipt:ack, p_error:invalidProfile ? 'invalid_profile' : null });
    return finished !== true ? 'superseded' : invalidProfile ? 'failed' : ack ? 'synced' : 'unchanged';
  } catch (error) {
    if (envelope) {
      const code = error instanceof Error && errors.has(error.message) ? error.message : 'temporarily_unavailable';
      try { await call(options.rpc,'finish_uv_profile_sync',{ ...args(job),p_version:envelope.version,p_receipt:null,p_error:code }); }
      catch { /* Keep the lease; expiry makes the frozen version retryable. Never log PII/secrets. */ }
    }
    return 'failed';
  }
}
export async function handleWorker(request: Request, options: Options): Promise<Response> {
  if (request.method !== 'POST') return json({error:'method_not_allowed'},405);
  const token = request.headers.get('authorization') ?? '';
  if (token.length>256 || !token.startsWith('Bearer ') || !await equalSecret(token.slice(7),options.workerSecret)) return json({error:'unauthorized'},401);
  if (!options.enabled) return json({enabled:false});
  if (options.syncSecret.length<32 || options.syncSecret===options.workerSecret) return json({error:'not_configured'},503);
  try {
    const jobs = await call(options.rpc,'claim_uv_profile_sync',{p_limit:5});
    if (!Array.isArray(jobs) || jobs.length>5 || !jobs.every(isJob)) throw new Error('invalid_jobs');
    const totals = {synced:0,unchanged:0,failed:0,superseded:0};
    for (const job of jobs) totals[await deliver(job,options)]++;
    return json(totals,totals.failed ? 503 : 200);
  } catch { return json({error:'temporarily_unavailable'},503); }
}
