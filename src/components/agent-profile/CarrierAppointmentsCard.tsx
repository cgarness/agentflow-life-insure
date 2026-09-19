/**
 * CarrierAppointmentsCard — the carriers the agent is appointed with.
 *
 * This is a DIFFERENT fact from the "Carriers" tile in the Business Snapshot, and the two are
 * labelled differently on purpose:
 *
 *   Business Snapshot "Carriers"  = distinct carriers appearing on actual POLICY records
 *   This card                     = the appointment list the agent maintains on their profile
 *
 * They routinely disagree, and neither is wrong. In production `profiles.carriers` is non-empty on
 * exactly 1 of 12 profiles, which is why the snapshot metric is policy-derived (decision D-4).
 *
 * An appointment entry holds a carrier name and a writing number — and nothing else. There is no
 * appointment date and no appointment status anywhere in the schema, so none is displayed or
 * implied. `normalizeProfileCarriers` is the canonical adapter for the mixed legacy shapes (bare
 * strings and `{carrier, writingNumber}` objects); this card imports it rather than re-deriving it,
 * unlike the previous page, which carried a divergent copy under a different field name.
 */

import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { normalizeProfileCarriers } from "@/components/settings/ProfileCarriersSection";
import { ProfileEmptyState, ProfileSection } from "./ProfilePrimitives";

export interface CarrierAppointmentsCardProps {
  /** Raw `profiles.carriers`. Mixed legacy shapes are handled by the canonical normalizer. */
  rawCarriers: unknown;
}

export const CarrierAppointmentsCard: React.FC<CarrierAppointmentsCardProps> = ({ rawCarriers }) => {
  const navigate = useNavigate();
  const carriers = useMemo(() => normalizeProfileCarriers(rawCarriers), [rawCarriers]);

  return (
    <ProfileSection
      title="Carrier appointments"
      description="Carriers on file for you, with writing numbers where recorded."
      action={
        <Button variant="outline" size="sm" onClick={() => navigate("/settings?section=my-profile")}>
          Manage carriers
        </Button>
      }
    >
      {carriers.length === 0 ? (
        <ProfileEmptyState
          icon={<Building2 className="h-6 w-6" />}
          title="No carrier appointments on file"
          description="Add the carriers you are appointed with so they appear on your profile."
          action={
            <Button size="sm" onClick={() => navigate("/settings?section=my-profile")}>
              Add a carrier
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {carriers.map((c) => (
            <li
              key={`${c.carrier}-${c.writingNumber}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-card px-4 py-3"
            >
              <span className="truncate text-sm font-medium text-foreground">{c.carrier}</span>
              {c.writingNumber.trim() ? (
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {c.writingNumber}
                </span>
              ) : (
                <span className="shrink-0 text-xs italic text-muted-foreground/70">
                  No writing #
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </ProfileSection>
  );
};
