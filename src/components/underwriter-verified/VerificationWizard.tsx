import { useEffect, useState } from 'react';
import { BadgeCheck, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { credentialsSchema, getSetup, identitySchema, setupDraftSchema, type SetupDraft, type SetupSnapshot } from '@/lib/uv-profile/setup';
import { type ProfileStatus, type Scope } from '@/lib/uv-profile/api';
import { VerificationFields } from './VerificationFields';
import { PublicProfileActions } from './PublicProfileActions';

type Props={scope:Scope;status:ProfileStatus;onClose:()=>void;onRefresh:()=>Promise<unknown>;
  onComplete:(snapshot:SetupSnapshot,draft:SetupDraft,phonePublic:boolean,emailPublic:boolean)=>Promise<unknown>};
const steps=['Profile details','Licenses','Review & confirm'];
export function VerificationWizard({scope,status,onClose,onComplete,onRefresh}:Props) {
  const [snapshot,setSnapshot]=useState<SetupSnapshot|null>(null);
  const [draft,setDraft]=useState<SetupDraft|null>(null);
  const [step,setStep]=useState(0);
  const [phase,setPhase]=useState<'editing'|'saving'|'waiting'>('editing');
  const [confirmed,setConfirmed]=useState(false);
  const [phonePublic,setPhonePublic]=useState(status.desired_published?status.phone_public:true);
  const [emailPublic,setEmailPublic]=useState(status.desired_published?status.email_public:true);
  const [error,setError]=useState('');
  const [waitExpired,setWaitExpired]=useState(false);
  useEffect(()=>{
    let active=true;
    void getSetup({profileId:scope.profileId,organizationId:scope.organizationId}).then(value=>{if(active){setSnapshot(value);setDraft(value.draft);}})
      .catch(()=>{if(active)setError('Unable to load your profile. Close and try again.');});
    return ()=>{active=false;};
  },[scope.profileId,scope.organizationId]);
  useEffect(()=>{
    if(phase!=='waiting') return;
    const timer=setTimeout(()=>setWaitExpired(true),30_000);
    return ()=>clearTimeout(timer);
  },[phase]);
  const success=phase==='waiting'&&status.verified===true&&status.state==='published';
  const pending=phase==='waiting'&&!success;
  function next(){
    const result=(step===0?identitySchema:credentialsSchema).safeParse(draft);
    if(!result.success){setError(result.error.issues[0]?.message??'Please complete the required fields.');return;}
    setError('');setStep(step+1);
  }
  async function submit(){
    if(!draft||!snapshot||!confirmed||phase!=='editing') return;
    const parsed=setupDraftSchema.safeParse(draft);
    if(!parsed.success){setError(parsed.error.issues[0]?.message??'Please check your information.');return;}
    setError('');setPhase('saving');
    try{await onComplete(snapshot,parsed.data,phonePublic,emailPublic);setPhase('waiting');}
    catch(err){setError(err instanceof Error?err.message:'Could not save. Please try again.');setPhase('editing');}
  }
  return <Dialog open onOpenChange={open=>{if(!open&&phase!=='saving')onClose();}}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" onEscapeKeyDown={e=>{if(phase==='saving')e.preventDefault();}} onInteractOutside={e=>{if(phase==='saving')e.preventDefault();}}>
      <DialogHeader><DialogTitle>{success?'Your agent site is ready':pending?'Setting up your agent site':'Get verified'}</DialogTitle>
        <DialogDescription>{success?'Your profile is complete and published.':phase==='editing'?'Confirm your details and create your Underwriter Verified page.':'Verifying your agent profile and publishing your page.'}</DialogDescription>
      </DialogHeader>
      {success?<div className="space-y-6 py-5 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/10 motion-safe:animate-in motion-safe:zoom-in"><BadgeCheck className="h-11 w-11 text-emerald-500"/></div>
        <p className="font-semibold text-emerald-600">Verified</p><PublicProfileActions url={status.public_url}/>
        <Button className="w-full" onClick={onClose}>Done</Button>
      </div>:phase!=='editing'?<div className="space-y-6 py-8 text-center" role="status" aria-live="polite">
        <Loader2 className={`mx-auto h-12 w-12 text-emerald-500 ${pending&&(waitExpired||status.state==='attention')?'':'motion-safe:animate-spin'}`}/>
        <div className="space-y-2 text-sm"><p>{phase==='saving'?'Verifying your agent profile…':'Profile details saved'}</p><p className="text-muted-foreground">{status.state==='attention'?'Your details were saved, but publishing needs another check.':pending&&waitExpired?'Your site is still being prepared. You can close this window and return shortly.':'Setting up your agent site…'}</p></div>
        {(waitExpired||status.state==='attention')&&<Button variant="outline" onClick={()=>void onRefresh()}>Check status</Button>}
        {pending&&<Button variant="ghost" onClick={onClose}>Close</Button>}
      </div>:!draft?<p className="py-6 text-sm" role="status">{error||'Loading your profile…'}</p>:<div className="space-y-6">
        <ol className="grid grid-cols-3 gap-2">{steps.map((label,i)=><li key={label} className={`border-t-2 pt-2 text-xs ${i<=step?'border-emerald-500 text-foreground':'border-muted text-muted-foreground'}`} aria-current={i===step?'step':undefined}>{i<step?<Check className="mb-1 h-4 w-4 text-emerald-500"/>:<span className="mb-1 block">0{i+1}</span>}{label}</li>)}</ol>
        <VerificationFields draft={draft} onChange={setDraft} step={step}/>
        {step===2&&<div className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-4 text-sm"><p className="font-semibold">{draft.first_name} {draft.last_name}</p><p className="mt-1 break-all text-muted-foreground">{draft.email}</p><p className="text-muted-foreground">{draft.phone}</p><p className="mt-3">NPN {draft.npn}</p><p className="text-muted-foreground">{draft.licenses.filter(l=>l.license_number.trim()).map(l=>`${l.state} #${l.license_number}`).join(' · ')}</p></div>
          <div className="flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><Checkbox checked={phonePublic} onCheckedChange={v=>setPhonePublic(v===true)}/>Show phone</label><label className="flex items-center gap-2"><Checkbox checked={emailPublic} onCheckedChange={v=>setEmailPublic(v===true)}/>Show email</label></div>
          <label className="flex items-start gap-3 text-sm"><Checkbox checked={confirmed} onCheckedChange={v=>setConfirmed(v===true)} className="mt-0.5"/><span>I confirm these profile details are accurate and want to publish my agent page.</span></label>
        </div>}
        {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex items-center justify-between gap-3"><Button variant="ghost" onClick={()=>{if(step===0)onClose();else{setStep(step-1);setError('');}}}>{step===0?'Cancel':'Back'}</Button>
          {step<2?<Button onClick={next}>Continue</Button>:<Button disabled={!confirmed||(!phonePublic&&!emailPublic)} onClick={()=>void submit()} className="bg-emerald-600 text-white hover:bg-emerald-700"><BadgeCheck className="mr-2 h-4 w-4"/>Confirm & get verified</Button>}
        </div>
        {step===2&&!phonePublic&&!emailPublic&&<p className="text-xs text-muted-foreground">Choose at least one contact option for your page.</p>}
      </div>}
    </DialogContent>
  </Dialog>;
}
