import React from "react";
import type { IdentifiedContact } from "@/contexts/TelnyxContext";
import { isInboundNameSameAsPhoneNumber } from "@/components/layout/inboundCallerDisplay";

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
  const rawIdName = (identifiedContact?.name || "").trim();
  const number = (identifiedContact?.number || fallbackNumber || "").trim();
  const idName =
    rawIdName && !isInboundNameSameAsPhoneNumber(rawIdName, number || rawIdName)
      ? rawIdName
      : "";
  const name = (idName || fallbackName || "").trim() || "Unknown Caller";
  const typeLabel = (identifiedContact?.type || "").trim();
  const phoneLine = number || "—";
  return (
    <>
      <p className={`font-bold text-foreground text-center px-1 ${nameClassName}`}>{name}</p>
      {typeLabel ? (
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {typeLabel}
        </span>
      ) : null}
      <p className="text-sm text-muted-foreground font-mono min-h-[1.25rem]">{phoneLine}</p>
    </>
  );
};
