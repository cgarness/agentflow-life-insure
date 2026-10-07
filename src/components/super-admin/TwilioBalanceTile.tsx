import React from "react";
import { useQuery } from "@tanstack/react-query";
import { DollarSign, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

type TwilioBalanceResponse = {
  balance: string;
  currency: string;
  updated_at: string;
};

function parseBalanceResponse(value: unknown): TwilioBalanceResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid balance response");
  }
  const row = value as Record<string, unknown>;
  const balance = typeof row.balance === "string" ? row.balance.trim() : "";
  const currency = typeof row.currency === "string" ? row.currency.trim() : "";
  const updatedAt = typeof row.updated_at === "string" ? row.updated_at.trim() : "";

  if (!balance || !Number.isFinite(Number(balance)) || !currency || !updatedAt) {
    throw new Error("Invalid balance response");
  }
  return { balance, currency, updated_at: updatedAt };
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

async function fetchTwilioBalance(): Promise<TwilioBalanceResponse> {
  const { data, error } = await supabase.functions.invoke("twilio-account-balance");
  if (error) throw new Error("Balance unavailable");
  return parseBalanceResponse(data);
}

const TwilioBalanceTile: React.FC = () => {
  const { isImpersonating } = useAuth();

  const query = useQuery({
    queryKey: ["super-admin", "twilio-account-balance"],
    queryFn: fetchTwilioBalance,
    enabled: !isImpersonating,
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (isImpersonating) return null;

  const unavailable = query.isError || (!query.isPending && !query.data);

  return (
    <Card className="relative overflow-hidden border-border/50 bg-card/80 backdrop-blur-sm">
      <CardContent className="p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground">Twilio Balance</p>
            {query.isPending ? (
              <div className="mt-2 space-y-2" aria-label="Loading Twilio balance">
                <Skeleton className="h-8 w-28" />
                <Skeleton className="h-3 w-10" />
              </div>
            ) : unavailable ? (
              <>
                <p className="mt-1 text-2xl font-bold tracking-tight text-muted-foreground">
                  Unavailable
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Balance could not be loaded</p>
              </>
            ) : (
              <>
                <p className="mt-1 text-3xl font-bold tracking-tight">
                  {formatBalance(query.data.balance, query.data.currency)}
                </p>
                <p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {query.data.currency}
                </p>
              </>
            )}
          </div>

          <div className="flex flex-col items-center gap-2">
            <div className="rounded-xl bg-cyan-600 p-3">
              <DollarSign className="h-5 w-5 text-white" />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Refresh Twilio balance"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </CardContent>
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-cyan-600" />
    </Card>
  );
};

export default TwilioBalanceTile;
