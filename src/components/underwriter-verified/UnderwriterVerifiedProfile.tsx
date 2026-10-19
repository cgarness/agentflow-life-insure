import { useState } from 'react';
import { BadgeCheck, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUnderwriterVerifiedProfile } from '@/hooks/useUnderwriterVerifiedProfile';
import { type ProfileStatus } from '@/lib/uv-profile/api';
import { PublicProfilePreferences } from './PublicProfilePreferences';
import { useAuth } from '@/contexts/AuthContext';
import { PublicProfileActions } from './PublicProfileActions';
import { VerificationWizard } from './VerificationWizard';

const labels = {disabled:'Not enabled',private:'Private',pending:'Syncing',published:'Published',attention:'Needs review'};
function OwnPublicProfile({ settings }: { settings: boolean }) {
  const profile = useUnderwriterVerifiedProfile(true);
  const [wizardScope,setWizardScope] = useState<string|null>(null);
  const [editing,setEditing] = useState<{scope:string;status:ProfileStatus}|null>(null);
  if (!profile.ready || (!profile.loading && !profile.error && profile.data?.state==='disabled')) return null;
  const status = profile.data;
  if (!settings) return <PublicProfileActions key={profile.scopeKey} url={status?.public_url ?? null} verified={status?.verified}/>;
  return <section className="rounded-lg border border-border bg-card px-4 py-3" aria-label="Underwriter Verified public profile">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0"><h3 className="text-sm font-medium">Underwriter Verified</h3>
        <p className="text-xs text-muted-foreground">{profile.error ? 'Unavailable' : profile.loading ? 'Loading…' : status?.verified ? 'Verified' : status ? labels[status.state] : 'Unavailable'}</p>
      </div>
      <div className="flex items-center gap-2">
        {status?.available && <Button size="sm" variant={status.verified?'outline':'default'}
          className={status.verified?'':'bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-950'}
          onClick={()=>setWizardScope(profile.scopeKey)}><BadgeCheck className="mr-2 h-4 w-4 text-emerald-500"/>{status.verified?'Edit verified profile':'Get verified'}</Button>}
        {(status?.state==='pending' || status?.state==='attention') &&
          <Button size="sm" variant="outline" onClick={() => void profile.refresh()}>Refresh</Button>}
        {profile.error ? <Button size="sm" variant="outline" onClick={() => void profile.refresh()}>Retry</Button> :
          <Button size="sm" variant="ghost" disabled={!status || profile.saving}
            onClick={() => status && setEditing({scope:profile.scopeKey,status})} aria-label="Edit public profile settings">
            <Settings2 className="h-4 w-4"/>
          </Button>}
      </div>
    </div>
    {status?.public_url && <div className="mt-3"><PublicProfileActions key={profile.scopeKey} url={status.public_url} verified={status.verified}/></div>}
    {wizardScope===profile.scopeKey && profile.scope && status && <VerificationWizard key={wizardScope} scope={profile.scope} status={status}
      onClose={()=>setWizardScope(null)} onComplete={profile.complete} onRefresh={profile.refresh}/>}
    {editing?.scope===profile.scopeKey && <PublicProfilePreferences key={`${editing.scope}:${editing.status.revision}`}
      status={editing.status} phone={profile.phone} email={profile.email} saving={profile.saving}
      onSave={async (preferences,revision) => profile.save({preferences,revision})} onClose={() => setEditing(null)}/>}
  </section>;
}
function ProfileAccess({ settings }: { settings: boolean }) {
  const auth = useAuth();
  const own = auth.realProfile;
  // Existing A2P evidence page: navigation only. Never enroll it or expose sync settings.
  const protectedOwner = auth.isLoading===false && auth.isImpersonating===false
    && auth.user?.id==='ecf2bb91-0350-4542-85ec-14d914311e99'
    && own?.id===auth.user.id && auth.profile?.id===own.id
    && own.organization_id==='a0000000-0000-0000-0000-000000000001'
    && auth.profile.organization_id===own.organization_id;
  if (protectedOwner) return <PublicProfileActions url="https://www.underwriterverified.com/cg-financial/christopher-garness" verified/>;
  return <OwnPublicProfile settings={settings}/>;
}
export function UnderwriterVerifiedProfile({ settings = false }: { settings?: boolean }) {
  // Release gate: no RPC or rendered control until the separately approved UI activation.
  return import.meta.env.VITE_UV_PROFILE_ENABLED==='true' ? <ProfileAccess settings={settings}/> : null;
}
