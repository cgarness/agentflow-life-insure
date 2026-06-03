import React, { useMemo } from "react";
import { ExternalLink, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BILLING_SOURCE_URLS,
  computeAiTestCallCost,
  type BillingConfidence,
  type SessionForBilling,
} from "@/lib/aiTestingBilling";

const CONFIDENCE_LABEL: Record<BillingConfidence, string> = {
  measured: "Measured",
  derived: "Derived",
  estimated: "Estimated",
};

const CONFIDENCE_VARIANT: Record<
  BillingConfidence,
  "default" | "secondary" | "outline"
> = {
  measured: "default",
  derived: "secondary",
  estimated: "outline",
};

type Props = {
  session: SessionForBilling | null;
  prompt: string;
  activeCall: boolean;
};

export const AITestingBillingPanel: React.FC<Props> = ({
  session,
  prompt,
  activeCall,
}) => {
  const estimate = useMemo(() => {
    if (!session?.stack) return null;
    return computeAiTestCallCost({ ...session, prompt });
  }, [session, prompt]);

  if (!session) {
    return (
      <p className="text-sm text-muted-foreground">
        Place a test call to see per-call cost breakdown. Estimates use measured usage
        from Twilio callbacks and the Render bridge when available.
      </p>
    );
  }

  if (!estimate || estimate.lineItems.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {activeCall
          ? "Waiting for usage metrics from the bridge and Twilio callbacks…"
          : "No billable usage recorded for this session yet."}
      </p>
    );
  }

  const stackLabel =
    estimate.stack === "deepgram_voice_agent"
      ? "Deepgram Voice Agent"
      : estimate.stack === "openai_realtime"
        ? "OpenAI Realtime"
        : estimate.stack;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{stackLabel}</Badge>
        {estimate.openAiModel && (
          <Badge variant="secondary">Model: {estimate.openAiModel}</Badge>
        )}
        <Badge variant={CONFIDENCE_VARIANT[estimate.overallConfidence]}>
          {CONFIDENCE_LABEL[estimate.overallConfidence]}
        </Badge>
        {estimate.metricsSource === "debug_log" && (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            Retrofit from debug log (lower confidence)
          </span>
        )}
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Line item</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">Subtotal</TableHead>
              <TableHead>Confidence</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {estimate.lineItems.map((row) => (
              <TableRow key={`${row.vendor}-${row.line}`}>
                <TableCell className="font-medium">
                  <span className="text-muted-foreground text-xs block">
                    {row.vendor}
                  </span>
                  {row.line}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.quantity.toFixed(4)}
                </TableCell>
                <TableCell>{row.unit}</TableCell>
                <TableCell className="text-right tabular-nums">
                  ${row.rateUsd.toFixed(4)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  ${row.subtotalUsd.toFixed(4)}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={CONFIDENCE_VARIANT[row.confidence]}
                    className="text-[10px]"
                  >
                    {CONFIDENCE_LABEL[row.confidence]}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-1">
        <p className="text-lg font-semibold tabular-nums">
          Total estimated: ${estimate.totalUsd.toFixed(4)} USD
        </p>
        <p className="text-xs text-muted-foreground">
          Rates as of {estimate.ratesAsOf} · Vendor invoices are authoritative
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <p>
          Lab estimates from measured seconds, media frame counts, and OpenAI token rules
          (1 token / 100 ms user audio, 1 token / 50 ms assistant audio). Small deltas vs
          Twilio/OpenAI invoices are normal (rounding, partial seconds, volume discounts).
        </p>
      </div>

      <div className="flex flex-wrap gap-3 text-xs">
        <a
          href={BILLING_SOURCE_URLS.twilio}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          Twilio pricing <ExternalLink className="w-3 h-3" />
        </a>
        <a
          href={BILLING_SOURCE_URLS.deepgram}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          Deepgram pricing <ExternalLink className="w-3 h-3" />
        </a>
        <a
          href={BILLING_SOURCE_URLS.openai}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          OpenAI API pricing <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  );
};
