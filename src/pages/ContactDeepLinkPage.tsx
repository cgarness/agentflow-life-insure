import React, { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, UserX } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import FullScreenContactView from "@/components/contacts/FullScreenContactView";
import { leadsSupabaseApi, rowToLead } from "@/lib/supabase-contacts";
import { clientsSupabaseApi, rowToClient } from "@/lib/supabase-clients";
import { recruitsSupabaseApi, rowToRecruit } from "@/lib/supabase-recruits";
import { contactManagementSettingsSupabaseApi } from "@/lib/supabase-settings";
import {
  ContactSaveRefusedError,
  DUPLICATE_SAVE_CANCELLED_MESSAGE,
  evaluateContactDuplicatePreSave,
  payloadTouchesPhoneOrEmail,
  type ContactDuplicateSettings,
} from "@/lib/contactSavePolicy";
import {
  Dialog as ConfirmDialog,
  DialogContent as ConfirmDialogContent,
  DialogHeader as ConfirmDialogHeader,
  DialogTitle as ConfirmDialogTitle,
  DialogDescription as ConfirmDialogDescription,
  DialogFooter as ConfirmDialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ContactType } from "@/lib/contactFieldLayout";

interface Props {
  contactType: ContactType;
}

/**
 * Marshal a RAW Supabase row into the canonical camelCase contact shape.
 *
 * `FullScreenContactView` reads the canonical shape throughout (`firstName`, `lastName`,
 * `phone`, `assignedAgentId`, `customFields`, …). Passing the raw snake_case row made its
 * Call button dispatch the literal name "undefined undefined", which was snapshotted into
 * `calls.contact_name`. These are the SAME mappers the list/detail APIs use — no second
 * contact shape is introduced here.
 */
function toCanonicalContact(contactType: ContactType, row: Record<string, unknown>) {
  if (contactType === "lead") return rowToLead(row);
  if (contactType === "client") return rowToClient(row);
  return rowToRecruit(row);
}

/** Thin page that deep-links directly to a single contact record by ID. */
const ContactDeepLinkPage: React.FC<Props> = ({ contactType }) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { organizationId } = useOrganization();

  const [contact, setContact] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [duplicatePrompt, setDuplicatePrompt] = useState<{
    label: string;
    description: string;
    onConfirm: () => void;
    onCancel: () => void;
  } | null>(null);

  /**
   * ── Staleness guards for async save results ──────────────────────────────
   *
   * `/leads/:id`, `/clients/:id` and `/recruits/:id` are three sibling `<Route>` elements
   * (`src/App.tsx:134-136`), so navigating between two contacts matches the SAME route and React
   * reuses this component INSTANCE — `useParams().id` changes, the fetch effect re-runs, but
   * `setContact` survives. A save for contact A that resolves after the user has moved to contact B
   * would therefore repaint B's page as A (and, because `key={contact.id}` below, remount the whole
   * detail view against the wrong record). `GlobalSearch` puts that navigation one keystroke away.
   *
   * These refs are written during render, which is the pattern this component tree already uses
   * (`FullScreenContactView.tsx:245-246`) and which matters here: an effect would lag a render, and
   * the guard must reflect the CURRENT route the instant a save resolves.
   */
  const currentIdRef = useRef<string | undefined>(id);
  currentIdRef.current = id;
  const contactTypeRef = useRef<ContactType>(contactType);
  contactTypeRef.current = contactType;

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** Monotonic save token: only the NEWEST save may install a row. */
  const saveTokenRef = useRef(0);

  /**
   * Agency duplicate-detection settings, fetched lazily on the first save that can actually match
   * and memoised per organization. A deep link that is only READ costs zero extra queries. A failed
   * settings read is not cached, so the next save retries it; the policy defaults apply meanwhile.
   */
  const duplicateSettingsRef = useRef<{ orgId: string; value: ContactDuplicateSettings | null } | null>(null);

  async function loadDuplicateSettings(orgId: string): Promise<ContactDuplicateSettings | null> {
    if (duplicateSettingsRef.current?.orgId === orgId) return duplicateSettingsRef.current.value;
    try {
      const value = (await contactManagementSettingsSupabaseApi.getSettings(orgId)) as ContactDuplicateSettings | null;
      duplicateSettingsRef.current = { orgId, value };
      return value;
    } catch (e) {
      console.error("Contact management settings load failed:", e);
      return null;
    }
  }

  /** Render the agency's duplicate warning and resolve with the user's answer. */
  function confirmDuplicate(prompt: { label: string; description: string }): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      setDuplicatePrompt({
        label: prompt.label,
        description: prompt.description,
        onConfirm: () => {
          setDuplicatePrompt(null);
          resolve(true);
        },
        onCancel: () => {
          setDuplicatePrompt(null);
          resolve(false);
        },
      });
    });
  }

  useEffect(() => {
    if (!id || !organizationId) return;

    let cancelled = false;

    async function fetchContact() {
      setLoading(true);
      setNotFound(false);

      try {
        // Use a raw query with explicit organization_id scope (defense-in-depth on top of RLS).
        // Always .maybeSingle() — never .single() — per AGENT_RULES §Database Null-Safety.
        const table =
          contactType === "lead"
            ? "leads"
            : contactType === "client"
            ? "clients"
            : "recruits";

        const { data, error } = await (supabase as any)
          .from(table)
          .select("*")
          .eq("id", id)
          .eq("organization_id", organizationId)
          .maybeSingle();

        if (cancelled) return;

        if (error || !data) {
          setNotFound(true);
        } else {
          setContact(toCanonicalContact(contactType, data));
        }
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchContact();
    return () => { cancelled = true; };
  }, [id, contactType, organizationId]);

  /**
   * Save a contact and adopt the row the database actually stored.
   *
   * UPDATE FIRST, then install the CANONICAL RETURNED ROW.
   *
   * This used to `SELECT` the row, install that PRE-UPDATE row as the parent `contact`, then issue
   * the UPDATE and discard everything it returned (AGENT_RULES invariant #35 open follow-up 3). The
   * consequences were not cosmetic: `FullScreenContactView` renders its own `editForm` for the field
   * grid but reads the PARENT prop for Quick Call, SMS, Email, the record header, the template merge
   * input, appointment prefill and the assigned-agent load — so after saving phone 1111 → 2222 the
   * screen showed 2222 while Call and SMS dialled 1111. Worse, `handleCancel` reseeds the form from
   * that stale parent, so a later unrelated edit wrote 1111 back over the committed 2222.
   *
   * All three canonical `update()` methods already run `UPDATE … .select().single()` and map the row
   * (`supabase-contacts.ts:176-183`, `supabase-clients.ts:149-156`, `supabase-recruits.ts:149-157`).
   * `.select()` with no argument IS `select("*")` — the same projection and the same mapper as this
   * page's own initial fetch — so the returned object is complete and a re-read would be redundant.
   * It also carries the server's normalisation (state, currency, dates, payment frequency,
   * `updated_at`), which is exactly why the RETURNED row must win over the submitted payload.
   *
   * Errors are never caught here: `FullScreenContactView.handleSave` needs the rejection to keep
   * edit mode open, preserve the typed values and the dirty state, write no activity row and show no
   * success toast (PR #376). Nothing is installed on a failed or refused save.
   */
  const handleUpdate = async (targetId: string, data: any) => {
    const savedType = contactType;

    // ── Pre-save: the agency's duplicate-detection settings, same policy as the Contacts page ──
    // Only when the payload carries phone or email; the partial `{ status }` payload the status
    // dropdown sends can never match and must not cost a query.
    if (organizationId && payloadTouchesPhoneOrEmail(data)) {
      const settings = await loadDuplicateSettings(organizationId);
      const decision = await evaluateContactDuplicatePreSave({
        contactType: savedType,
        organizationId,
        settings,
        phone: (data?.phone as string) ?? null,
        email: (data?.email as string) ?? null,
        assignedAgentId: (data?.assignedAgentId as string) ?? contact?.assignedAgentId ?? null,
        excludeId: targetId,
      });

      if (decision.kind === "block") {
        // Report the agency's reason here — same message and same single toast the Contacts
        // surface raises — then REFUSE. A refusal must reject, never resolve: a resolved
        // `onUpdate` is what `FullScreenContactView` treats as proof the write happened.
        toast.error(decision.message);
        throw new ContactSaveRefusedError(decision.message);
      }

      if (decision.kind === "confirm") {
        const proceed = await confirmDuplicate(decision);
        // The dialog the user just cancelled WAS the message, so no second toast here.
        if (!proceed) throw new ContactSaveRefusedError(DUPLICATE_SAVE_CANCELLED_MESSAGE);
      }
    }

    const token = ++saveTokenRef.current;

    const updated =
      savedType === "lead"
        ? await leadsSupabaseApi.update(targetId, data)
        : savedType === "client"
        ? await clientsSupabaseApi.update(targetId, data)
        : await recruitsSupabaseApi.update(targetId, data);

    // Fail-closed: the save is already durably committed, so dropping a stale local echo costs
    // nothing, while applying one would repaint a different contact's page.
    if (!mountedRef.current) return;
    if (saveTokenRef.current !== token) return;
    if (currentIdRef.current !== targetId) return;
    if (contactTypeRef.current !== savedType) return;

    setContact(updated);
  };

  const handleDelete = async (_id: string) => {
    if (contactType === "lead") await leadsSupabaseApi.delete(_id);
    else if (contactType === "client") await clientsSupabaseApi.delete(_id);
    else await recruitsSupabaseApi.delete(_id);
    navigate(-1);
  };

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ── Not found / access denied ─────────────────────────────────────────────
  if (notFound || !contact) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
          <UserX className="w-8 h-8 text-muted-foreground" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-foreground mb-1">Contact not found</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            This record may have been deleted or you don't have access to it.
          </p>
        </div>
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-muted text-foreground text-sm hover:bg-accent transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Go back
        </button>
      </div>
    );
  }

  // ── Contact found ─────────────────────────────────────────────────────────
  return (
    <>
      <FullScreenContactView
        key={contact.id}
        contact={contact}
        type={contactType}
        onClose={() => navigate(-1)}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
      />
      {/*
        The agency's "warn" duplicate prompt. Mirrors the Contacts page dialog (Contacts.tsx:3464)
        so both full-record edit surfaces ask the same question in the same words. It renders in a
        portal above the full-screen view, and closing it by any route resolves the pending save
        promise — an unresolved prompt would hang the save forever.
      */}
      <ConfirmDialog
        open={!!duplicatePrompt}
        onOpenChange={(o) => { if (!o && duplicatePrompt) duplicatePrompt.onCancel(); }}
      >
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>{duplicatePrompt?.label ?? "Possible duplicate"}</ConfirmDialogTitle>
            <ConfirmDialogDescription className="whitespace-pre-line">
              {duplicatePrompt?.description ?? ""}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <Button variant="ghost" onClick={() => duplicatePrompt?.onCancel()}>Cancel</Button>
            <Button onClick={() => duplicatePrompt?.onConfirm()}>Save Anyway</Button>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </>
  );
};

export default ContactDeepLinkPage;
