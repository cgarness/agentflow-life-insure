import React from "react";
import type { IdentifiedContact } from "@/contexts/TwilioContext";
import { isInboundNameSameAsPhoneNumber } from "@/components/layout/inboundCallerDisplay";
import { formatPhoneNumber } from "@/utils/phoneUtils";

type Props = {
  identifiedContact: IdentifiedContact | null;
  fallbackName: string;
  fallbackNumber: string;
  nameClassName?: string;
};

function isGarbageInboundHeadlineLabel(s: string): boolean {
  const t = s.trim().toLowerCase();
  return (
    !t ||
    t === "unknown caller" ||
    t === "unknown" ||
    t === "outbound call" ||
    t === "anonymous"
  );
}

/** Prominent CRM name + phone for inbound ring / active (from `calls.contact_id` pipeline). */
export const InboundCallIdentity: React.FC<Props> = ({
  identifiedContact,
  fallbackName,
  fallbackNumber,
  nameClassName = "text-lg",
}) => {
  const numberRaw = (identifiedContact?.number || fallbackNumber || "").trim();
  const formattedPhone = formatPhoneNumber(numberRaw) || numberRaw;

  const rawIdName = (identifiedContact?.name || "").trim();
  const idName =
    rawIdName && !isInboundNameSameAsPhoneNumber(rawIdName, numberRaw || rawIdName)
      ? rawIdName
      : "";

  const rawFb = (fallbackName || "").trim();
  const fbHuman =
    rawFb &&
    !isGarbageInboundHeadlineLabel(rawFb) &&
    !isInboundNameSameAsPhoneNumber(rawFb, numberRaw)
      ? rawFb
      : "";

  const headline =
    idName || fbHuman || formattedPhone || numberRaw || "Incoming call";

  const digitCount = numberRaw.replace(/\D/g, "").length;
  const hasRealDigits = digitCount >= 10;
  const headlineIsGeneric = headline === "Incoming call";
  const headlineIsPhoneOnly =
    hasRealDigits &&
    !idName &&
    !fbHuman &&
    (headline === formattedPhone || headline === numberRaw);

  const showPhoneSubtitle =
    (!headlineIsPhoneOnly && Boolean(idName || fbHuman) && hasRealDigits) ||
    (headlineIsGeneric && hasRealDigits);
  const typeLabel = (identifiedContact?.type || "").trim();
  const phoneLine = formattedPhone || numberRaw || "—";

  return (
    <>
      <p className={`font-bold text-foreground text-center px-1 ${nameClassName}`}>{headline}</p>
      {typeLabel ? (
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {typeLabel}
        </span>
      ) : null}
      {showPhoneSubtitle ? (
        <p className="text-sm text-muted-foreground font-mono min-h-[1.25rem]">{phoneLine}</p>
      ) : null}
    </>
  );
};
