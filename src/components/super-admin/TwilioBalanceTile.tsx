import React from "react";
import { RefreshCw, WalletCards } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

interface TwilioBalanceResponse {
  balance: string;
  currency: string;
  updated_at: string;
}

function isTwilioBalanceResponse(value: unknown): value is TwilioBalanceResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.balance === "string" &&
    row.balance.trim() !== "" &&
    Number.isFinite(Number(row.balance)) &&
    typeof row.currency === "string" &&
    /^[A-Z]{3}$/.test(row.currency) &&
    typeof row.updated_at === "string" &&
    row.updated_at.trim() !== ""
  );
}

async function fetchTwilioBalance(): Promise<TwilioBalanceResponse> {
  const { data, error } = await supabase.functions.invoke<TwilioBalanceResponse>(
    "twilio-account-balance",
    { method: "GET" },
  );

  if (error || !isTwilioBalanceResponse(data)) {
    throw new Error("Twilio balance unavailable");
  }
  return data;
}

function formatBalance(balance: string, currency: string): string {
  const amount = Number(balance);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return amount.toFixed(2);
  }
}

const TwilioBalanceTile: React.FC = () => {
  const { realProfile, isImpersonating } = useAuth();
  const enabled = !isImpersonating && realProfile?.is_super_admin === true;

  const {
    data,
    isPending,
    isFetching,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["super-admin", "twilio-master-balance"],
    queryFn: fetchTwilioBalance,
    enabled,
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (!enabled) return null;

  const unavailable = isError || (!isPending && !data);

  return (
    <Card className="relative overflow-hidden border-border/50 bg-card/80 backdrop-blur-sm">
      <CardContent className="p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground">Twilio Balance</p>
            {isPending ? (
              <div
                data-testid="twilio-balance-skeleton"
                className="mt-2 h-9 w-28 animate-pulse rounded-md bg-muted"
              />
            ) : unavailable ? (
              <p className="mt-1 text-2xl font-bold tracking-tight text-muted-foreground">
                Unavailable
              </p>
            ) : (
              <>
                <p className="mt-1 text-3xl font-bold tracking-tight">
                  {formatBalance(data.balance, data.currency)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{data.currency}</p>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Refresh Twilio balance"
              title="Refresh Twilio balance"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
            <div className="rounded-xl bg-cyan-600 p-3">
              <WalletCards className="h-5 w-5 text-white" />
            </div>
          </div>
        </div>
      </CardContent>
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-cyan-600" />
    </Card>
  );
};

export default TwilioBalanceTile;
