import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('spam-check-cron started');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: phoneNumbers, error: numbersError } = await supabase
      .from('phone_numbers')
      .select('id, phone_number')
      .eq('status', 'active');

    if (numbersError) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch phone numbers' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Recalculating spam scores for ${phoneNumbers?.length || 0} numbers`);

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const results = [];

    // Minimum calls required before assigning a real status
    const MIN_CALLS_7D = 5;
    const MIN_CALLS_30D = 10;

    for (const phone of phoneNumbers || []) {
      try {
        const { data: calls7d } = await supabase
          .from('calls')
          .select('id, sip_response_code, shaken_stir, provider_error_code, quality_percentage, mos')
          .eq('caller_id_used', phone.phone_number)
          .gte('started_at', sevenDaysAgo);

        const { data: calls30d } = await supabase
          .from('calls')
          .select('id, sip_response_code, shaken_stir, provider_error_code')
          .eq('caller_id_used', phone.phone_number)
          .gte('started_at', thirtyDaysAgo);

        const total7d = calls7d?.length || 0;
        const total30d = calls30d?.length || 0;

        const rejected7d = calls7d?.filter((c: any) =>
          c.sip_response_code === 603 || c.sip_response_code === 608
        ).length || 0;
        const rate7d = total7d > 0 ? parseFloat(((rejected7d / total7d) * 100).toFixed(2)) : 0;

        const rejected30d = calls30d?.filter((c: any) =>
          c.sip_response_code === 603 || c.sip_response_code === 608
        ).length || 0;
        const rate30d = total30d > 0 ? parseFloat(((rejected30d / total30d) * 100).toFixed(2)) : 0;

        // SHAKEN/STIR stats
        const shakenA = calls30d?.filter((c: any) =>
          c.shaken_stir === 'A' || c.shaken_stir === 'B' || c.shaken_stir === 'C'
        ).length || 0;
        const shakenUnavailable = calls30d?.filter((c: any) =>
          !c.shaken_stir || c.shaken_stir === 'unavailable' || c.shaken_stir === ''
        ).length || 0;
        const shakenRate = total30d > 0
          ? parseFloat(((shakenA / total30d) * 100).toFixed(2))
          : 0;

        const d51Count = calls30d?.filter((c: any) =>
          c.provider_error_code === 'D51'
        ).length || 0;

        // Quality averages
        const connectedCalls = calls7d?.filter((c: any) => c.quality_percentage !== null) || [];
        const avgQuality = connectedCalls.length > 0
          ? parseFloat((connectedCalls.reduce((sum: number, c: any) =>
              sum + (c.quality_percentage || 0), 0) / connectedCalls.length).toFixed(2))
          : null;
        const avgMos = connectedCalls.length > 0
          ? parseFloat((connectedCalls.reduce((sum: number, c: any) =>
              sum + (c.mos || 0), 0) / connectedCalls.length).toFixed(4))
          : null;

        // Determine spam status
        // If not enough calls yet, show a neutral holding status instead of Unknown
        let spamStatus: string;
        let spamScore: number | null = null;
        const hasEnoughData = total7d >= MIN_CALLS_7D || total30d >= MIN_CALLS_30D;
        const callsNeeded = hasEnoughData ? 0 : Math.max(MIN_CALLS_7D - total7d, 0);

        if (!hasEnoughData) {
          // Not enough call history yet — show neutral holding status
          spamStatus = 'Insufficient Data';
          spamScore = null;
        } else {
          const effectiveRate = total7d >= MIN_CALLS_7D ? rate7d : rate30d;
          const shakenPenalty = total30d >= 5 && shakenRate < 50 ? 15 : 0;
          const adjustedRate = Math.min(effectiveRate + shakenPenalty, 100);
          spamScore = Math.round(100 - adjustedRate);

          if (adjustedRate < 10) spamStatus = 'Clean';
          else if (adjustedRate < 30) spamStatus = 'At Risk';
          else spamStatus = 'Flagged';
        }

        const carrierReputationData = {
          source: 'sip_cdr',
          method: 'SIP 603/608 rejection rate + SHAKEN/STIR attestation',
          last_updated: now.toISOString(),
          calls_needed_for_score: callsNeeded,
          summary_7d: { total_calls: total7d, rejected_calls: rejected7d, rejection_rate_pct: rate7d },
          summary_30d: { total_calls: total30d, rejected_calls: rejected30d, rejection_rate_pct: rate30d },
          shaken_stir: { attested: shakenA, unavailable: shakenUnavailable, attestation_rate_pct: shakenRate },
          d51_blocks_30d: d51Count,
          quality: { avg_quality_pct: avgQuality, avg_mos: avgMos },
          thresholds: { clean: '< 10% rejection', at_risk: '10-30% rejection', flagged: '> 30% rejection' },
          minimum_calls_required: `${MIN_CALLS_7D} calls in 7 days or ${MIN_CALLS_30D} calls in 30 days`,
        };

        const { error: updateError } = await supabase
          .from('phone_numbers')
          .update({
            spam_status: spamStatus,
            spam_score: spamScore,
            total_calls_7d: total7d,
            rejected_calls_7d: rejected7d,
            rejection_rate_7d: rate7d,
            total_calls_30d: total30d,
            rejected_calls_30d: rejected30d,
            rejection_rate_30d: rate30d,
            shaken_stir_a_count: shakenA,
            shaken_stir_unavailable_count: shakenUnavailable,
            shaken_stir_rate: shakenRate,
            d51_count: d51Count,
            avg_quality_percentage: avgQuality,
            avg_mos: avgMos,
            carrier_reputation_data: carrierReputationData,
            spam_checked_at: now.toISOString(),
          })
          .eq('id', phone.id);

        if (updateError) {
          results.push({ phone_number: phone.phone_number, status: 'update_failed' });
        } else {
          console.log(`✅ ${phone.phone_number}: ${spamStatus} (score: ${spamScore ?? 'n/a'}) | 7d: ${total7d} calls | needs: ${callsNeeded} more`);
          results.push({
            phone_number: phone.phone_number,
            status: 'success',
            spam_status: spamStatus,
            spam_score: spamScore,
            calls_needed: callsNeeded,
            total_calls_7d: total7d,
            rejection_rate_7d: rate7d,
          });
        }

      } catch (err) {
        console.error(`Error processing ${phone.phone_number}:`, err);
        results.push({ phone_number: phone.phone_number, status: 'error' });
      }
    }

    return new Response(
      JSON.stringify({ success: true, checked: phoneNumbers?.length || 0, results }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
