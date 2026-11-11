import { useState } from "react";
import { Copy, ExternalLink, Mail, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  carrierEmailHref, carrierPhoneHref, safeCarrierWebUrl, type CarrierDirectoryItem,
} from "@/lib/carrierResources";

interface DisplayLink { id: string; label: string; href: string }

function LinkGroup({ title, links }: { title: string; links: DisplayLink[] }) {
  if (links.length === 0) return null;
  return (
    <section className="min-w-0 space-y-1" aria-label={title}>
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      <ul>
        {links.map((link) => (
          <li key={link.id}>
            <a href={link.href} target="_blank" rel="noopener noreferrer"
              className="flex min-h-11 items-center justify-between gap-3 rounded-md py-2 text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="min-w-0 break-words">{link.label}<span className="sr-only"> (opens in a new tab)</span></span>
              <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function CarrierResources({ carrier }: { carrier: CarrierDirectoryItem }) {
  const [copyStatus, setCopyStatus] = useState("");
  const portal = safeCarrierWebUrl(carrier.portal_url);
  const links = carrier.resource_links.flatMap((link) => {
    const href = safeCarrierWebUrl(link.url);
    return href && link.label.trim() && href !== portal ? [{ ...link, href }] : [];
  });
  const quickLinks: DisplayLink[] = [
    ...(portal ? [{ id: "agent-portal", label: "Agent portal", href: portal }] : []),
    ...links.filter((link) => link.group === "quick_links"),
  ];
  const guideLinks = links.filter((link) => link.group === "guides_training");
  const phones = carrier.contact_phones.filter((contact) => contact.value.trim());
  const emails = carrier.contact_emails.filter((contact) => contact.value.trim());
  const hasContacts = phones.length > 0 || emails.length > 0;

  const copyPhone = async (value: string) => {
    setCopyStatus("");
    try {
      await navigator.clipboard.writeText(value.trim());
      setCopyStatus("Phone number copied.");
    } catch {
      setCopyStatus("Could not copy. Select the number to copy it.");
    }
  };

  if (!quickLinks.length && !guideLinks.length && !hasContacts) {
    return <p className="py-2 text-sm text-muted-foreground">No resources added yet.</p>;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 sm:gap-x-8">
      <LinkGroup title="Quick links" links={quickLinks} />
      <LinkGroup title="Guides & training" links={guideLinks} />
      {hasContacts && (
        <section className="min-w-0 space-y-2 sm:col-span-2" aria-label="Contacts">
          <h3 className="text-sm font-medium text-muted-foreground">Contacts</h3>
          <div className="grid gap-2 sm:grid-cols-2 sm:gap-x-8">
            {phones.map((contact, index) => {
              const href = carrierPhoneHref(contact.value);
              const label = contact.label.trim() || "Phone";
              return (
                <div key={`phone-${index}`} className="flex min-w-0 items-center justify-between gap-2">
                  <div className="min-w-0 py-1">
                    <p className="break-words text-xs text-muted-foreground">{label}</p>
                    {href ? (
                      <a href={href} className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-md text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <Phone className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="min-w-0 break-all">{contact.value}</span>
                      </a>
                    ) : <p className="break-all py-2">{contact.value}</p>}
                  </div>
                  <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0"
                    aria-label={`Copy ${label} phone number`} onClick={() => void copyPhone(contact.value)}>
                    <Copy className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              );
            })}
            {emails.map((contact, index) => {
              const href = carrierEmailHref(contact.value);
              return (
                <div key={`email-${index}`} className="min-w-0 py-1">
                  <p className="break-words text-xs text-muted-foreground">{contact.label.trim() || "Email"}</p>
                  {href ? (
                    <a href={href} className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-md text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <Mail className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="min-w-0 break-all">{contact.value}</span>
                    </a>
                  ) : <p className="break-all py-2">{contact.value}</p>}
                </div>
              );
            })}
          </div>
        </section>
      )}
      <p role="status" aria-live="polite" className={copyStatus ? "text-xs text-muted-foreground sm:col-span-2" : "sr-only"}>{copyStatus}</p>
    </div>
  );
}
