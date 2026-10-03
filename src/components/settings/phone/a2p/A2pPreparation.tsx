import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { preparationSchema } from "./schema";
import { type Draft, emptyDraft } from "./types";
export function A2pPreparation(
  { initial, initialVersion, busy, onSave }: {
    initial?: Draft;
    initialVersion: number | null;
    busy: boolean;
    onSave: (draft: Draft, version: number | null) => Promise<unknown>;
  },
) {
  const [version, setVersion] = useState(initialVersion);
  const [form, setForm] = useState<Draft>(initial ?? emptyDraft),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [saved, setSaved] = useState(false);
  const set = (name: keyof Draft, value: string) => {
    setForm((f) => ({ ...f, [name]: value }));
    setSaved(false);
  };
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = preparationSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    const result = await onSave(parsed.data as Draft, version) as { registration?: { version: number } } | null;
    if (result?.registration) {
      setVersion(result.registration.version);
      setSaved(true);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border bg-card p-5">
      <div>
        <h4 className="font-semibold">Prepare your registration</h4>
        <p className="mt-1 text-sm text-muted-foreground">
          Save your starting details. The secure form collects your tax ID, address, authorized representative,
          verification, and complete messaging application.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="a2p-businessName">Legal business name</Label>
          <Input
            id="a2p-businessName"
            value={form.businessName}
            onChange={(e) => set("businessName", e.target.value)}
            disabled={busy}
          />
          {errors.businessName && <p role="alert" className="text-sm text-destructive">{errors.businessName}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="a2p-brandType">Business registration</Label>
          <select
            id="a2p-brandType"
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={form.brandType}
            onChange={(e) => set("brandType", e.target.value)}
            disabled={busy}
          >
            <option value="STANDARD">Business with EIN / tax ID</option>
            <option value="SOLE_PROPRIETOR">Sole proprietor without EIN</option>
          </select>
          <p className="text-xs text-muted-foreground">
            Have an EIN? Choose business registration, even as an individual. Messaging volume is selected in the secure
            form.
          </p>
        </div>
        {(["website", "privacyUrl", "termsUrl"] as const).map((name) => (
          <div key={name} className="space-y-2">
            <Label htmlFor={`a2p-${name}`}>
              {name === "website"
                ? "Business website"
                : name === "privacyUrl"
                ? "Privacy policy URL"
                : "Terms and conditions URL"}
            </Label>
            <Input
              id={`a2p-${name}`}
              value={form[name]}
              placeholder="https://"
              onChange={(e) => set(name, e.target.value)}
              disabled={busy}
            />
            {errors[name] && <p role="alert" className="text-sm text-destructive">{errors[name]}</p>}
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <Label htmlFor="a2p-description">What will your agency text customers about?</Label>
        <Textarea
          id="a2p-description"
          value={form.description}
          maxLength={4096}
          onChange={(e) => set("description", e.target.value)}
          disabled={busy}
          placeholder="Describe your actual insurance messaging and who will receive it."
        />
      </div>
      <details className="rounded-lg bg-muted/40 p-3 text-sm">
        <summary className="cursor-pointer font-medium">What to have ready</summary>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">
          <li>Exact legal business details and an authorized representative who can complete verification.</li>
          <li>Messaging purpose, expected volume, and representative sample messages.</li>
          <li>Every opt-in method, the exact consent disclosure, and links or evidence reviewers can access.</li>
          <li>Published privacy policy and messaging terms matching your opt-in form.</li>
          <li>STOP / HELP instructions, support contact, and any keyword confirmation messages.</li>
        </ul>
        <p className="mt-3 text-muted-foreground">
          Lead imports and phone verification alone do not establish permission to send your agency’s marketing texts.
          Describe your actual consent process.
        </p>
      </details>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="outline" disabled={busy}>Save preparation</Button>
        <span role="status" className="text-sm text-muted-foreground">{saved ? "Saved" : null}</span>
      </div>
    </form>
  );
}
