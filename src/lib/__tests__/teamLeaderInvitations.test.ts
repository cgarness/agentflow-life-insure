import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import * as emailAuth from '../../../supabase/functions/_shared/systemEmailAuth';

const org = 'a0000000-0000-0000-0000-000000000001';
const leader = '10000000-0000-4000-8000-000000000001';
const other = '20000000-0000-4000-8000-000000000002';
const baseProfile = { organization_id: org, role: 'Team Leader', is_super_admin: false };
const payload = { firstName: 'New', lastName: 'Agent', email: 'agent@example.com', role: 'Agent', licensedStates: [], commissionLevel: '50%' };

function setup(profile: any = baseProfile, invitationPatch: Record<string, unknown> = {}) {
  const invitation = { id: 'invite-1', email: 'agent@example.com', first_name: 'New', role: 'Agent',
    organization_id: org, status: 'Pending', token: 'test-token', invited_by: leader, upline_id: leader,
    expires_at: new Date(Date.now() + 86400000).toISOString(), ...invitationPatch };
  const inserted: any[] = [];
  const selected: Record<string, string[]> = {};
  const send = vi.fn().mockResolvedValue({ data: { id: 'mail-1' }, error: null });
  const getUser = vi.fn().mockResolvedValue({ data: { user: { id: leader, email: 'leader@example.com', email_confirmed_at: '2026-01-01' } }, error: null });
  const client = { auth: { getUser }, from: (table: string) => {
    const q: any = {
      select: (columns: string) => { (selected[table] ??= []).push(columns); return q; },
      eq: () => q,
      insert: (row: any) => { inserted.push(row); return q; },
      maybeSingle: async () => ({ data: table === 'profiles' ? profile : table === 'organizations' ? { name: 'Test Agency' } : invitation, error: null }),
      single: async () => ({ data: { id: 'invite-1', token: 'test-token' }, error: null }),
    };
    return q;
  } };
  function load(slug: string) {
    let handler: (req: Request) => Promise<Response>;
    const source = readFileSync(`supabase/functions/${slug}/index.ts`, 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const require = (name: string) => {
      if (name.includes('/http/server.ts')) return { serve: (fn: typeof handler) => { handler = fn; } };
      if (name.includes('@supabase/supabase-js')) return { createClient: () => client };
      if (name.includes('resend@')) return { Resend: class { emails = { send }; } };
      if (name.endsWith('/systemEmailAuth.ts')) return emailAuth;
      if (name.endsWith('/systemEmail.ts')) return { resolveSiteUrl: () => 'https://example.com', SYSTEM_EMAIL_FROM: 'test@example.com' };
      if (name.endsWith('/systemEmailTemplates.ts')) return { renderTeamInvitationEmail: () => ({ subject: 'Invitation', html: '<p>Invitation</p>', text: 'Invitation' }) };
      throw new Error(`Unexpected module: ${name}`);
    };
    const module = { exports: {} };
    new Function('require', 'module', 'exports', 'Deno', code)(require, module, module.exports, {
      env: { get: (key: string) => ({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'isolated-test-only', RESEND_API_KEY: 'isolated-test-only' })[key] },
    });
    return async (body: any, authorized = true) => {
      const res = await handler!(new Request('https://example.com', { method: 'POST', headers: {
        'Content-Type': 'application/json', ...(authorized ? { Authorization: 'Bearer test-jwt' } : {}),
      }, body: JSON.stringify(body) }));
      return { status: res.status, body: await res.json() };
    };
  }
  return { load, inserted, send, getUser, selected };
}

describe('Team Leader initial invitations (actual handler)', () => {
  it('allows Agent invitation and derives org/upline server-side', async () => {
    const s = setup();
    expect((await s.load('invite-user')(payload)).status).toBe(200);
    expect(s.inserted[0]).toMatchObject({ organization_id: org, role: 'Agent', invited_by: leader, upline_id: leader, team_id: null });
    expect(s.send).toHaveBeenCalledTimes(1);
  });
  it('accepts explicit self-upline used by the new UI', async () => {
    const s = setup();
    expect((await s.load('invite-user')({ ...payload, uplineId: leader })).status).toBe(200);
    expect(s.inserted[0].upline_id).toBe(leader);
  });
  it('accepts legacy null upline but does not create an unassigned user', async () => {
    const s = setup();
    expect((await s.load('invite-user')({ ...payload, uplineId: null })).status).toBe(200);
    expect(s.inserted[0].upline_id).toBe(leader);
  });
  it.each(['Team Leader', 'Admin', 'Super Admin'])('denies Team Leader assigning %s', async role => {
    const s = setup();
    expect((await s.load('invite-user')({ ...payload, role })).status).toBe(403);
    expect(s.inserted).toHaveLength(0); expect(s.send).not.toHaveBeenCalled();
  });
  it.each([{ uplineId: other }, { teamId: other }, { organization_id: other }, { organizationId: other }])('rejects forged assignment %j', async forged => {
    const s = setup();
    expect((await s.load('invite-user')({ ...payload, ...forged })).status).toBe(403);
    expect(s.inserted).toHaveLength(0);
  });
  it.each(['Agent', 'Unknown'])('denies %s caller', async role => {
    const s = setup({ ...baseProfile, role });
    expect((await s.load('invite-user')(payload)).status).toBe(403);
    expect(s.inserted).toHaveLength(0);
  });
  it('requires authentication', async () => {
    const s = setup(); expect((await s.load('invite-user')(payload, false)).status).toBe(401);
    expect(s.getUser).not.toHaveBeenCalled(); expect(s.inserted).toHaveLength(0);
  });
  it('rejects invalid JWT', async () => {
    const s = setup(); s.getUser.mockResolvedValue({ data: { user: null }, error: new Error('expired') });
    expect((await s.load('invite-user')(payload)).status).toBe(401);
  });
  it('fails closed without caller profile or organization', async () => {
    expect((await setup(null).load('invite-user')(payload)).status).toBe(403);
    expect((await setup({ ...baseProfile, organization_id: null }).load('invite-user')(payload)).status).toBe(400);
  });
  it.each(['Agent', 'Team Leader', 'Admin'])('preserves Admin invitation of %s', async role => {
    const s = setup({ ...baseProfile, role: 'Admin' });
    expect((await s.load('invite-user')({ ...payload, role, uplineId: other, teamId: other })).status).toBe(200);
    expect(s.inserted[0]).toMatchObject({ role, upline_id: other, team_id: other });
  });
  it('requires platform super-admin flag to invite Super Admin', async () => {
    expect((await setup({ ...baseProfile, role: 'Admin' }).load('invite-user')({ ...payload, role: 'Super Admin' })).status).toBe(403);
    expect((await setup({ ...baseProfile, is_super_admin: true }).load('invite-user')({ ...payload, role: 'Super Admin' })).status).toBe(200);
  });
  it('does not report a rejected email as sent', async () => {
    const s = setup(); s.send.mockResolvedValue({ data: null, error: { message: 'mail rejected' } });
    const res = await s.load('invite-user')(payload);
    expect(res.status).toBe(200); expect(res.body.email_sent).toBe(false); expect(s.inserted).toHaveLength(1);
  });
});

describe('Team Leader resends (actual handler)', () => {
  it('resends own pending Agent invitation from stored row only', async () => {
    const s = setup();
    const res = await s.load('send-invite-email')({ invitation_id: 'invite-1', email: 'attacker@example.com' });
    expect(res.status).toBe(200); expect(res.body.email_sent).toBe(true);
    expect(s.send).toHaveBeenCalledWith(expect.objectContaining({ to: ['agent@example.com'] }));
    expect(s.selected.invitations[0]).toContain('invited_by');
    expect(s.selected.invitations[0]).toContain('upline_id');
    expect(s.selected.invitations[0]).toContain('expires_at');
  });
  it.each([{ invited_by: other }, { upline_id: other }, { organization_id: other }, { role: 'Admin' }])('conceals out-of-scope invitation %j', async patch => {
    const s = setup(baseProfile, patch);
    expect((await s.load('send-invite-email')({ invitation_id: 'invite-1' })).status).toBe(404);
    expect(s.send).not.toHaveBeenCalled();
  });
  it.each([{ status: 'Revoked' }, { status: 'Accepted' }, { expires_at: '2020-01-01' }, { expires_at: 'invalid' }])('rejects unusable invitation %j', async patch => {
    const s = setup(baseProfile, patch);
    expect((await s.load('send-invite-email')({ invitation_id: 'invite-1' })).status).toBe(409);
    expect(s.send).not.toHaveBeenCalled();
  });
  it('preserves Admin resend of another inviter in own organization', async () => {
    const s = setup({ ...baseProfile, role: 'Admin' }, { invited_by: other, upline_id: other, role: 'Team Leader' });
    expect((await s.load('send-invite-email')({ invitation_id: 'invite-1' })).status).toBe(200);
  });
  it('preserves ordinary Admin cross-organization denial', async () => {
    const s = setup({ ...baseProfile, role: 'Admin' }, { organization_id: other });
    expect((await s.load('send-invite-email')({ invitation_id: 'invite-1' })).status).toBe(404);
  });
  it('preserves existing platform super-admin scope', async () => {
    const s = setup({ ...baseProfile, is_super_admin: true }, { organization_id: other, invited_by: other });
    expect((await s.load('send-invite-email')({ invitation_id: 'invite-1' })).status).toBe(200);
  });
  it('does not make Team Leaders general organization administrators', () => {
    expect(emailAuth.isOrgAdmin(baseProfile)).toBe(false);
    expect(emailAuth.canManageOrganization(baseProfile, org)).toBe(false);
  });
  it('denies ordinary Agents and missing authentication', async () => {
    expect((await setup({ ...baseProfile, role: 'Agent' }).load('send-invite-email')({ invitation_id: 'invite-1' })).status).toBe(403);
    expect((await setup().load('send-invite-email')({ invitation_id: 'invite-1' }, false)).status).toBe(401);
  });
  it('surfaces resend email failure without a false success', async () => {
    const s = setup(); s.send.mockResolvedValue({ data: null, error: { message: 'mail rejected' } });
    const res = await s.load('send-invite-email')({ invitation_id: 'invite-1' });
    expect(res.status).toBe(502); expect(res.body.email_sent).toBe(false);
  });
});
