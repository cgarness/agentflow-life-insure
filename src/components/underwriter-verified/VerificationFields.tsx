import { useState } from 'react';
import { Camera, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { type SetupDraft, stateCodes } from '@/lib/uv-profile/setup';

type Props={draft:SetupDraft;onChange:(value:SetupDraft)=>void;step:number};
export function VerificationFields({draft,onChange,step}:Props) {
  const [photoError,setPhotoError]=useState('');
  const field=(key:keyof SetupDraft,label:string,type='text') => <label className="block space-y-1.5 text-sm" key={key}>{label}
    <Input type={type} value={String(draft[key])} onChange={e=>onChange({...draft,[key]:e.target.value})} autoComplete={key==='first_name'?'given-name':key==='last_name'?'family-name':key==='email'?'email':key==='phone'?'tel':'off'}/></label>;
  async function photo(file?:File) {
    if(!file) return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>3_000_000) {setPhotoError('Choose a JPG, PNG or WebP photo under 3 MB.');return;}
    const reader=new FileReader();
    reader.onload=()=>{onChange({...draft,avatar_url:String(reader.result)});setPhotoError('');};
    reader.onerror=()=>setPhotoError('Unable to read this photo. Please try another.');
    reader.readAsDataURL(file);
  }
  if(step===0) return <div className="space-y-5">
    <div className="flex items-center gap-4">
      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xl font-semibold">
        {draft.avatar_url?<img src={draft.avatar_url} alt="Profile preview" className="h-full w-full object-cover"/>:<Camera className="h-7 w-7 text-muted-foreground"/>}
      </div>
      <label className="cursor-pointer text-sm font-medium text-emerald-600 hover:text-emerald-700">{draft.avatar_url?'Change photo':'Add profile photo'}
        <input aria-label="Profile photo" type="file" accept="image/jpeg,image/png,image/webp" className="mt-2 block w-full max-w-52 text-xs text-muted-foreground" onChange={e=>void photo(e.target.files?.[0])}/>
      </label>
    </div>
    {photoError&&<p role="alert" className="text-sm text-destructive">{photoError}</p>}
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{field('first_name','First name')}{field('last_name','Last name')}</div>
    {field('phone','Phone number','tel')}{field('email','Email','email')}
  </div>;
  if(step===1) return <div className="space-y-5">
    {field('npn','National Producer Number (NPN)')}
    <div className="space-y-3"><p className="text-sm font-medium">State licenses</p>
      {draft.licenses.map((license,index)=><div key={license.id??index} className="flex items-end gap-2 rounded-lg border p-3">
        <label className="min-w-0 flex-1 space-y-1 text-xs">State
          {license.id?<Input value={license.state} readOnly aria-label={`State ${index+1}`}/>:<select aria-label={`State ${index+1}`} className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm" value={license.state}
            onChange={e=>onChange({...draft,licenses:draft.licenses.map((l,i)=>i===index?{...l,state:e.target.value}:l)})}>
            <option value="">Select state</option>{stateCodes.map(state=><option key={state}>{state}</option>)}
          </select>}
        </label>
        <label className="min-w-0 flex-[2] space-y-1 text-xs">License number<Input aria-label={`License number ${index+1}`} value={license.license_number} maxLength={50}
          onChange={e=>onChange({...draft,licenses:draft.licenses.map((l,i)=>i===index?{...l,license_number:e.target.value}:l)})}/></label>
        {!license.id&&<Button variant="ghost" size="icon" aria-label={`Remove new license ${index+1}`} onClick={()=>onChange({...draft,licenses:draft.licenses.filter((_,i)=>i!==index)})}><Trash2 className="h-4 w-4"/></Button>}
      </div>)}
      <Button variant="outline" size="sm" disabled={draft.licenses.length>=60} onClick={()=>onChange({...draft,licenses:[...draft.licenses,{id:null,state:'',license_number:'',expiration_date:null}]})}><Plus className="mr-2 h-4 w-4"/>Add state license</Button>
    </div>
  </div>;
  return <label className="block space-y-2 text-sm">About you <span className="text-muted-foreground">(optional)</span>
    <Textarea value={draft.bio} maxLength={2000} rows={4} placeholder="Tell clients a little about yourself and how you help families." onChange={e=>onChange({...draft,bio:e.target.value})}/>
    <span className="block text-right text-xs text-muted-foreground">{draft.bio.length}/2,000</span>
  </label>;
}
