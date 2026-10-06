import type { SmsPurpose } from "@/lib/sms-intent";
export function SmsPurposeSelect({value,onChange}:{value:SmsPurpose;onChange:(value:SmsPurpose)=>void}) {
  return <label className="block text-xs text-muted-foreground">Text purpose
    <select aria-label="Text purpose" className="mt-1 w-full rounded-md border bg-background px-2 py-2 text-sm text-foreground" value={value} onChange={e=>onChange(e.target.value as SmsPurpose)}>
      <option value="">Choose purpose</option><option value="informational">Informational — requested service or appointment</option><option value="marketing">Marketing — promotional or mixed content</option>
    </select>
  </label>;
}
