import { useState } from 'react';
import { Copy,ExternalLink,Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUnderwriterVerifiedProfile } from '@/hooks/useUnderwriterVerifiedProfile';
import { type ProfileStatus } from '@/lib/uv-profile/api';
import { PublicProfilePreferences } from './PublicProfilePreferences';
import { useAuth } from '@/contexts/AuthContext';

const labels = {disabled:'Not enabled',private:'Private',pending:'Syncing',published:'Published',attention:'Needs review'};
function OwnPublicProfile() {
  const profile = useUnderwriterVerifiedProfile(true);
  const [editing,setEditing] = useState<{scope:string;status:ProfileStatus}|null>(null);
  const [copy,setCopy] = useState('');
  if (!profile.ready || (!profile.loading && !profile.error && profile.data?.state==='disabled')) return null;
  const status = profile.data;
  async function copyLink() {
    if (!status?.public_url) return;
    try { await navigator.clipboard.writeText(status.public_url); setCopy('Link copied'); }
    catch { setCopy('Unable to copy link'); }
  }
  return <section className="rounded-lg border border-border bg-card px-4 py-3" aria-label="Underwriter Verified public profile">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0"><h3 className="text-sm font-medium">Underwriter Verified</h3>
        <p className="text-xs text-muted-foreground">{profile.error ? 'Unavailable' : profile.loading ? 'Loading…' : status ? labels[status.state] : 'Unavailable'}</p>
      </div>
      <div className="flex items-center gap-2">
        {status?.public_url && <><Button size="sm" variant="outline" asChild>
          <a href={status.public_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-3.5 w-3.5"/>View</a>
        </Button><Button size="sm" variant="outline" onClick={copyLink}><Copy className="mr-2 h-3.5 w-3.5"/>Copy</Button></>}
        {(status?.state==='pending' || status?.state==='attention') &&
          <Button size="sm" variant="outline" onClick={() => void profile.refresh()}>Refresh</Button>}
        {profile.error ? <Button size="sm" variant="outline" onClick={() => void profile.refresh()}>Retry</Button> :
          <Button size="sm" variant="ghost" disabled={!status || profile.saving}
            onClick={() => status && setEditing({scope:profile.scopeKey,status})} aria-label="Edit public profile settings">
            <Settings2 className="h-4 w-4"/>
          </Button>}
      </div>
    </div>
    {copy && <p role="status" className="mt-2 text-xs text-muted-foreground">{copy}</p>}
    {editing?.scope===profile.scopeKey && <PublicProfilePreferences key={`${editing.scope}:${editing.status.revision}`}
      status={editing.status} phone={profile.phone} email={profile.email} saving={profile.saving}
      onSave={async (preferences,revision) => profile.save({preferences,revision})} onClose={() => setEditing(null)}/>}
  </section>;
}
function ProfileAccess() {
  const auth = useAuth();
  const own = auth.realProfile;
  // Existing A2P evidence page: navigation only. Never enroll it or expose sync settings.
  const protectedOwner = auth.isLoading===false && auth.isImpersonating===false
    && auth.user?.id==='ecf2bb91-0350-4542-85ec-14d914311e99'
    && own?.id===auth.user.id && auth.profile?.id===own.id
    && own.organization_id==='a0000000-0000-0000-0000-000000000001'
    && auth.profile.organization_id===own.organization_id;
  if (protectedOwner) return <section className="rounded-lg border border-border bg-card px-4 py-3" aria-label="Underwriter Verified public profile">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-sm font-medium">Underwriter Verified</h3>
      <Button size="sm" variant="outline" asChild>
        <a href="https://www.underwriterverified.com/cg-financial/christopher-garness" target="_blank" rel="noopener noreferrer">
          <ExternalLink className="mr-2 h-3.5 w-3.5"/>View
        </a>
      </Button>
    </div>
  </section>;
  return <OwnPublicProfile/>;
}
export function UnderwriterVerifiedProfile() {
  // Release gate: no RPC or rendered control until the separately approved UI activation.
  return import.meta.env.VITE_UV_PROFILE_ENABLED==='true' ? <ProfileAccess/> : null;
}
