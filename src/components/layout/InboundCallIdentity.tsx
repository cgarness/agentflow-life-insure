import React from "react";
import type { IdentifiedContact } from "@/contexts/TelnyxContext";

type Props = {
  identifiedContact: IdentifiedContact | null;
  fallbackName: string;
  fallbackNumber: string;
  nameClassName?: string;
};

/** Prominent CRM name + phone for inbound ring / active (from `calls.contact_id` pipeline). */
export const InboundCallIdentity: React.FC<Props> = ({
  identifiedContact,
  fallbackName,
  fallbackNumber,
  nameClassName = "text-lg",
}) => {
  const name = (identifiedContact?.name || fallbackName || "").trim() || "Unknown caller";
  const number = (identifiedContact?.number || fallbackNumber || "").trim();
  return (
    <>
      <p className={`font-bold text-foreground text-center px-1 ${nameClassName}`}>{name}</p>
      {number ? <p className="text-sm text-muted-foreground font-mono">{number}</p> : null}
    </>
  );
};
