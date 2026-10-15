import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InviteUserModal from '../InviteUserModal';

const mocks = vi.hoisted(() => ({
  invite: vi.fn(), generateInviteLink: vi.fn(), toast: vi.fn(), copy: vi.fn(),
  auth: { user: { id: '10000000-0000-4000-8000-000000000001' },
    profile: null as Record<string, unknown> | null, realProfile: null as Record<string, unknown> | null },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/hooks/useOrganization', () => ({ useOrganization: () => ({ organizationId: 'a0000000-0000-0000-0000-000000000001' }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/lib/supabase-users', () => ({ usersSupabaseApi: { invite: mocks.invite, generateInviteLink: mocks.generateInviteLink } }));
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));

function show() {
  const onSuccess = vi.fn(), onClose = vi.fn();
  render(<InviteUserModal open onClose={onClose} onSuccess={onSuccess} managers={[]} />);
  return { onSuccess, onClose };
}
function fill(email = 'new@example.com', firstName = ' New ') {
  fireEvent.change(screen.getByLabelText('First Name *'), { target: { value: firstName } });
  fireEvent.change(screen.getByLabelText('Last Name *'), { target: { value: ' Agent ' } });
  fireEvent.change(screen.getByLabelText('Email *'), { target: { value: email } });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.realProfile = { id: mocks.auth.user.id, first_name: 'Team', last_name: 'Leader', role: 'Team Leader', is_super_admin: false,
    organization_id: 'a0000000-0000-0000-0000-000000000001' };
  mocks.auth.profile = mocks.auth.realProfile;
  mocks.invite.mockResolvedValue({ invitation_id: 'invite-1', token: 'test-token', email_sent: true });
  mocks.generateInviteLink.mockResolvedValue('https://example.com/accept-invite?token=test-token');
  mocks.copy.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: mocks.copy } });
});

describe('Team Leader invitation modal', () => {
  it('locks role and upline without requiring manager-list results', () => {
    show();
    expect(screen.getByLabelText('Role')).toBeDisabled();
    expect(screen.getByLabelText('Upline Manager')).toBeDisabled();
    expect(screen.getByLabelText('Upline Manager')).toHaveTextContent('Team Leader');
  });
  it('sends trimmed Agent details beneath the real Team Leader', async () => {
    const { onSuccess } = show(); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Send Invitation' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(mocks.invite).toHaveBeenCalledWith(expect.objectContaining({ firstName: 'New', lastName: 'Agent', role: 'Agent', uplineId: mocks.auth.user.id }));
  });
  it('copy-link uses the same authorized payload and refreshes pending invitations', async () => {
    const { onSuccess } = show(); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Copy Invite Link' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(mocks.invite).toHaveBeenCalledWith(expect.objectContaining({ role: 'Agent', uplineId: mocks.auth.user.id }));
    expect(mocks.copy).toHaveBeenCalledWith('https://example.com/accept-invite?token=test-token');
  });
  it.each(['Send Invitation', 'Copy Invite Link'])('validates email before %s', async action => {
    show(); fill('not-an-email');
    fireEvent.click(screen.getByRole('button', { name: action }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(mocks.invite).not.toHaveBeenCalled();
  });
  it('rejects whitespace-only names', async () => {
    show(); fill('new@example.com', '   ');
    fireEvent.click(screen.getByRole('button', { name: 'Send Invitation' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(mocks.invite).not.toHaveBeenCalled();
  });
  it('shares an in-flight lock across send and copy', async () => {
    let resolve!: (value: unknown) => void;
    mocks.invite.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    show(); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Send Invitation' }));
    expect(screen.getByRole('button', { name: 'Copy Invite Link' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Copy Invite Link' }));
    expect(mocks.invite).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ invitation_id: 'invite-1', token: 'test-token', email_sent: true }));
  });
  it('does not enable invitations for an ordinary Agent', () => {
    mocks.auth.realProfile!.role = 'Agent'; show(); fill();
    expect(screen.getByRole('button', { name: 'Send Invitation' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Copy Invite Link' })).toBeDisabled();
  });
  it('fails closed while the real profile is unresolved', () => {
    mocks.auth.realProfile = null; show();
    expect(screen.getByRole('button', { name: 'Send Invitation' })).toBeDisabled();
  });
  it('preserves Admin role and upline controls', () => {
    mocks.auth.realProfile!.role = 'Admin'; show();
    expect(screen.getByLabelText('Role')).not.toBeDisabled();
    expect(screen.getByLabelText('Upline Manager')).not.toBeDisabled();
  });
  it('honors the real platform super-admin flag', () => {
    mocks.auth.realProfile!.is_super_admin = true; show();
    expect(screen.getByLabelText('Role')).not.toBeDisabled();
  });
  it('does not derive authority from a displayed impersonated profile', () => {
    mocks.auth.profile = { ...mocks.auth.realProfile, role: 'Admin' }; show();
    expect(screen.getByLabelText('Role')).toBeDisabled();
  });
  it('retains the created invitation when clipboard access fails', async () => {
    mocks.copy.mockRejectedValueOnce(new Error('Clipboard denied'));
    const { onSuccess } = show(); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Copy Invite Link' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(mocks.invite).toHaveBeenCalledTimes(1);
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Invitation created' }));
  });
});
