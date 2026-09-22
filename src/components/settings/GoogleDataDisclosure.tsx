import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { emailSupabaseApi } from "@/lib/supabase-email";
import { googleConnectionsUrl } from "@/content/legal";
import { toast } from "@/hooks/use-toast";

type Props = { kind: "email" | "calendar"; onRemoved?: () => void | Promise<void> };
export default function GoogleDataDisclosure({ kind, onRemoved }: Props) {
  const [busy, setBusy] = useState(false);
  const removeAccess = async () => {
    setBusy(true);
    try {
      const result = await emailSupabaseApi.removeGoogleAccess();
      toast({ title: result.google_access_revoked ? "Google access removed" : "Google connections stopped", description: result.warning || "Gmail and Calendar are disconnected. Imported CRM history remains." });
      await onRemoved?.();
    } catch (error) {
      toast({ title: "Unable to remove Google access", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3 text-xs leading-relaxed text-muted-foreground">
      <p>{kind === "email"
        ? "Connecting Gmail lets AgentFlow read and import mailbox messages, including messages not matched to a contact, and send email you initiate. Imported messages may be visible to authorized agency leadership. Consider this before connecting a personal inbox."
        : "Connecting Google Calendar lets AgentFlow list your calendars and synchronize appointment events using the settings you choose."}</p>
      <p>Sync can continue while you are signed out. Disconnect stops future sync; imported records remain. <Link to="/privacy" className="text-primary underline">Privacy Policy</Link> · <Link to="/terms" className="text-primary underline">Terms of Service</Link></p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <a href={googleConnectionsUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">Manage access in Google</a>
        <AlertDialog>
          <AlertDialogTrigger asChild><Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" disabled={busy}>{busy ? "Removing access…" : "Remove Google access"}</Button></AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>Remove Google access?</AlertDialogTitle><AlertDialogDescription>This stops both Gmail and Google Calendar connections in AgentFlow and requests revocation from Google. Imported messages and appointments remain. You will need to reconnect to use these integrations again.</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void removeAccess()}>Remove Google access</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
