import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { customFieldSchema } from "@/components/settings/contact-flow/contactFlowSchemas";
import { CUSTOM_FIELD_MESSAGES, isOrganizationWideCustomFieldConflict } from "@/lib/custom-field-errors";
import { classifyRequestedFieldName, normalizeFieldName } from "@/lib/import-field-matching";
import { STANDARD_FIELDS, type CatalogField, type CustomFieldType } from "@/lib/google-sheets/schema";
import { customFieldsSupabaseApi } from "@/lib/supabase-settings";
import { provisionStandardLeadFields, STANDARD_LEAD_FIELD_NAMES, standardFieldForName, StandardFieldsError } from "@/lib/standard-lead-fields";

const TYPES: CustomFieldType[] = ["Text", "Number", "Date", "Dropdown", "Email", "Phone"];
const BUILT_IN_KEY = new Map<string, string>(STANDARD_FIELDS.map((f) => [f.label, f.key]));

export interface CreateFieldViewer { canManageAgency: boolean; isImpersonating: boolean; organizationId: string | null }
interface Props {
  suggestedName: string;
  fields: CatalogField[];
  viewer: CreateFieldViewer;
  /** Re-reads the server catalog; resolves to the fresh field list (null when it failed). */
  refreshCatalog: () => Promise<CatalogField[] | null>;
  onMapped: (target: string, message: string) => void;
  onCancel: () => void;
}

/**
 * Inline "Create custom field" for one sheet column, with the SAME rules as Settings and the CSV importer: shared Zod
 * schema, one logical name per agency (classifyRequestedFieldName, then the database guard), built-ins never shadowed.
 * Standard fields (Address, City, ZIP Code) are agency-wide: an Admin adds them for the agency; anyone else is told to
 * ask an Admin, so no personal copy blocks the name again. A name held by a field this user cannot see fails closed.
 */
const CreateCustomFieldForm: React.FC<Props> = ({ suggestedName, fields, viewer, refreshCatalog, onMapped, onCancel }) => {
  const standard = standardFieldForName(suggestedName);
  const [name, setName] = useState(standard?.name ?? suggestedName.trim().slice(0, 40));
  const [type, setType] = useState<CustomFieldType>("Text");
  const [options, setOptions] = useState("");
  const [agencyWide, setAgencyWide] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isStandard = standardFieldForName(name) !== null;

  const mapByName = (list: CatalogField[] | null, n: string) => list?.find((f) => normalizeFieldName(f.name) === normalizeFieldName(n)) ?? null;

  const submit = async () => {
    if (viewer.isImpersonating) { setError(CUSTOM_FIELD_MESSAGES.viewAs); return; }
    const trimmed = name.trim();
    if (/\(\s*custom\s*\)/i.test(trimmed)) { setError('Leave "(Custom)" out of the name.'); return; }
    const dropdownOptions = type === "Dropdown" ? options.split(",").map((o) => o.trim()).filter(Boolean) : [];
    const parsed = customFieldSchema.safeParse({ name: trimmed, type: isStandard ? "Text" : type, appliesTo: ["Leads"], required: false,
      active: true, defaultValue: "", dropdownOptions, orgWide: agencyWide && viewer.canManageAgency });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "That field is not valid."); return; }
    const verdict = classifyRequestedFieldName(parsed.data.name,
      fields.map((f) => ({ id: f.id, name: f.name, createdBy: f.created_by, createdAt: f.created_at })), { standardNames: STANDARD_LEAD_FIELD_NAMES });
    if (verdict.kind === "builtin") {
      const key = BUILT_IN_KEY.get(verdict.builtInName);
      if (key) onMapped(key, `"${verdict.builtInName}" is a built-in field, so the column was mapped to it.`);
      else setError(`"${verdict.builtInName}" is a built-in field that Google Sheets doesn't import. Choose another name.`);
      return;
    }
    if (verdict.kind === "existing") { onMapped(`custom:${verdict.field.id}`, `${verdict.field.name} already exists and was selected.`); return; }
    setBusy(true); setError(null);
    try {
      if (verdict.kind === "standard") {
        if (!viewer.canManageAgency) {
          setError(`${verdict.name} is a standard field your agency shares. Ask an Admin to add it (Settings → Contact Management), then try again.`);
          return;
        }
        await provisionStandardLeadFields(false);
        const field = mapByName(await refreshCatalog(), verdict.name);
        if (field) onMapped(`custom:${field.id}`, `${field.name} was added for your agency.`);
        else setError(`${verdict.name} exists as someone's personal field. Make it agency-wide in Settings → Contact Management first.`);
        return;
      }
      const created = await customFieldsSupabaseApi.create({ name: parsed.data.name, type: parsed.data.type, appliesTo: ["Leads"], required: false,
        active: true, defaultValue: "", dropdownOptions }, viewer.organizationId, { orgWide: Boolean(parsed.data.orgWide) });
      await refreshCatalog();
      onMapped(`custom:${created.id}`, `Custom field "${created.name}" created.`);
    } catch (e) {
      if (isOrganizationWideCustomFieldConflict(e)) {
        const field = mapByName(await refreshCatalog(), trimmed);
        if (field) { onMapped(`custom:${field.id}`, `${field.name} already exists and was selected.`); return; }
        setError(`A field named "${trimmed}" already exists in this agency, but it isn't available to your account. Ask an Admin to make it available.`);
      } else {
        setError(e instanceof StandardFieldsError || e instanceof Error ? e.message : "The field was not created. Try again.");
      }
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3 rounded-lg border p-3" role="group" aria-label="Create custom field">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="gs-new-field" className="text-xs">Field name</Label>
          <Input id="gs-new-field" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Type</Label>
          <Select value={isStandard ? "Text" : type} onValueChange={(v) => setType(v as CustomFieldType)} disabled={isStandard}>
            <SelectTrigger aria-label="Field type"><SelectValue /></SelectTrigger>
            <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      {!isStandard && type === "Dropdown" && (
        <div className="space-y-1">
          <Label htmlFor="gs-new-options" className="text-xs">Options (comma separated)</Label>
          <Input id="gs-new-options" value={options} onChange={(e) => setOptions(e.target.value)} />
        </div>
      )}
      {isStandard ? (
        <p className="text-xs text-muted-foreground">Standard field: shared with your whole agency, stored as text so ZIP codes keep leading zeros.</p>
      ) : viewer.canManageAgency ? (
        <div className="flex items-center gap-2">
          <Switch id="gs-new-agency" checked={agencyWide} onCheckedChange={setAgencyWide} />
          <Label htmlFor="gs-new-agency" className="text-sm">Agency-wide (everyone in your agency can use it)</Label>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Personal field: only you will see it.</p>
      )}
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="button" size="sm" onClick={submit} disabled={busy || !name.trim()}>{isStandard ? "Add standard field" : "Create field"}</Button>
      </div>
    </div>
  );
};

export default CreateCustomFieldForm;
