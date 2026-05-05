import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, UserX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import FullScreenContactView from "@/components/contacts/FullScreenContactView";
import { leadsSupabaseApi } from "@/lib/supabase-contacts";
import { clientsSupabaseApi } from "@/lib/supabase-clients";
import { recruitsSupabaseApi } from "@/lib/supabase-recruits";
import type { ContactType } from "@/lib/contactFieldLayout";

interface Props {
  contactType: ContactType;
}

/** Thin page that deep-links directly to a single contact record by ID. */
const ContactDeepLinkPage: React.FC<Props> = ({ contactType }) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { organizationId } = useOrganization();

  const [contact, setContact] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

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
          setContact(data);
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

  const handleUpdate = async (_id: string, _data: any) => {
    // Re-fetch after update so FullScreenContactView reflects the saved state.
    const table =
      contactType === "lead" ? "leads" : contactType === "client" ? "clients" : "recruits";
    const { data } = await (supabase as any)
      .from(table)
      .select("*")
      .eq("id", _id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (data) setContact(data);

    if (contactType === "lead") await leadsSupabaseApi.update(_id, _data);
    else if (contactType === "client") await clientsSupabaseApi.update(_id, _data);
    else await recruitsSupabaseApi.update(_id, _data);
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
    <FullScreenContactView
      key={contact.id}
      contact={contact}
      type={contactType}
      onClose={() => navigate(-1)}
      onUpdate={handleUpdate}
      onDelete={handleDelete}
    />
  );
};

export default ContactDeepLinkPage;
