import { record, UUID, version } from './protocol.ts';

export type PublicProfile = { published: false } | {
  published: true; first_name: string; last_name: string; phone: string; email: string;
  agency: string; agency_slug: string; npn: string; headshot_url: string; state_licenses: string[];
};
export interface ProfileEnvelope {
  schema: 1; organization_id: string; profile_id: string; version: string; profile: PublicProfile;
}
export const STATE_CODES = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '));
export function safePhoto(value: string): boolean {
  if (!value) return true;
  if (value.length > 4_000_000) return false;
  if (value.startsWith('https://')) {
    try {
      const url = new URL(value);
      return !url.username && !url.password && (!url.port || url.port === '443')
        && url.hostname.includes('.') && !url.hostname.endsWith('.') && !/^[\d.]+$/.test(url.hostname)
        && !url.hostname.includes(':') && !/(^|\.)(localhost|local|internal)$/.test(url.hostname);
    } catch { return false; }
  }
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || match[2].length % 4 !== 0) return false;
  try {
    const start = atob(match[2].slice(0, 40));
    if (match[1] === 'png') return start.startsWith('\x89PNG\r\n\x1a\n');
    if (match[1] === 'jpeg') return start.startsWith('\xff\xd8\xff');
    return start.startsWith('RIFF') && start.slice(8, 12) === 'WEBP';
  } catch { return false; }
}
function text(value: unknown, max: number, required = false): value is string {
  return typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0)
    && !/[\u0000-\u001f\u007f]/.test(value);
}
export function parseEnvelope(value: unknown): ProfileEnvelope {
  const invalid = () => { throw new Error('invalid_profile'); };
  if (!record(value) || value.schema !== 1 || typeof value.organization_id !== 'string'
    || !UUID.test(value.organization_id) || typeof value.profile_id !== 'string' || !UUID.test(value.profile_id)
    || !version(value.version) || !record(value.profile)
    || Object.keys(value).some(k => !['schema','organization_id','profile_id','version','profile'].includes(k))) return invalid();
  const p = value.profile;
  if (p.published === false && Object.keys(p).length === 1) return value as unknown as ProfileEnvelope;
  const fields = ['published','first_name','last_name','phone','email','agency','agency_slug','npn','headshot_url','state_licenses'];
  if (p.published !== true || Object.keys(p).length !== fields.length || Object.keys(p).some(k => !fields.includes(k))
    || !text(p.first_name,50,true) || !text(p.last_name,50,true) || !text(p.phone,40) || !text(p.email,254)
    || !text(p.agency,120,true) || !text(p.agency_slug,80,true) || !/^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$/.test(p.agency_slug)
    || !text(p.npn,40) || typeof p.headshot_url !== 'string' || !safePhoto(p.headshot_url)
    || !Array.isArray(p.state_licenses) || p.state_licenses.length > 60 || p.state_licenses.some(l =>
      typeof l !== 'string' || !/^[A-Z]{2} - #[^\u0000-\u001f\u007f]{1,50}$/.test(l) || !STATE_CODES.has(l.slice(0,2)))) return invalid();
  return value as unknown as ProfileEnvelope;
}
