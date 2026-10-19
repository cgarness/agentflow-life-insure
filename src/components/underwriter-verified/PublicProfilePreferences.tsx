import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription } from '@/components/ui/dialog';
import { preferencesSchema,type Preferences,type ProfileStatus } from '@/lib/uv-profile/api';

interface Props {
  status:ProfileStatus; phone:string; email:string; saving:boolean; onClose:() => void;
  onSave:(preferences:Preferences,revision:string) => Promise<unknown>;
}
export function PublicProfilePreferences({status,phone,email,saving,onClose,onSave}:Props) {
  const [value,setValue] = useState<Preferences>({published:status.desired_published,phonePublic:status.phone_public,emailPublic:status.email_public});
  const [error,setError] = useState('');
  async function submit(event:React.FormEvent) {
    event.preventDefault();
    setError('');
    try { await onSave(preferencesSchema.parse(value),status.revision); onClose(); }
    catch { setError('Could not save. Close and reopen settings to try again.'); }
  }
  return <Dialog open onOpenChange={open => {if (!open && !saving) onClose();}}>
    <DialogContent className="sm:max-w-md" onEscapeKeyDown={event => {if (saving) event.preventDefault();}}
      onInteractOutside={event => {if (saving) event.preventDefault();}}>
      <DialogHeader><DialogTitle>Public profile</DialogTitle></DialogHeader>
      <form onSubmit={submit} className="space-y-5">
        <DialogDescription>Publish your name, photo, NPN and state licenses on Underwriter Verified.</DialogDescription>
        <label className="flex items-center gap-3 text-sm font-medium">
          <Checkbox checked={value.published} disabled={saving || (!status.available && !value.published)}
            onCheckedChange={checked => setValue(v => ({...v,published:checked===true}))}/>Publish profile
        </label>
        <label className="flex items-start gap-3 text-sm">
          <Checkbox checked={value.phonePublic} disabled={saving}
            onCheckedChange={checked => setValue(v => ({...v,phonePublic:checked===true}))}/>
          <span>Show phone number{phone && <span className="block text-muted-foreground">{phone}</span>}</span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <Checkbox checked={value.emailPublic} disabled={saving}
            onCheckedChange={checked => setValue(v => ({...v,emailPublic:checked===true}))}/>
          <span>Show email{email && <span className="block break-all text-muted-foreground">{email}</span>}</span>
        </label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
