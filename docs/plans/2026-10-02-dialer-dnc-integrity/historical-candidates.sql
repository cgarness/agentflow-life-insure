-- READ ONLY. Supply one explicitly selected organization_id as a psql variable.
-- Candidate evidence is not approval to repair. Current configuration cannot prove past intent.
BEGIN READ ONLY;
WITH evidence AS (
  SELECT cl.id AS campaign_lead_id,cl.organization_id,cl.campaign_id,
    cl.lead_id,cl.last_advance_call_id,c.id AS call_id,c.disposition_id,
    d.name AS current_disposition_name,d.dnc_auto_add AS currently_auto_dnc,
    private.phone_digits_e164ish(c.contact_phone) AS call_phone,
    private.phone_digits_e164ish(cl.phone) AS membership_phone
  FROM public.campaign_leads cl
  LEFT JOIN public.calls c ON c.id=cl.last_advance_call_id
    AND c.campaign_lead_id=cl.id AND c.organization_id=cl.organization_id
  LEFT JOIN public.dispositions d ON d.id=c.disposition_id AND d.organization_id=cl.organization_id
  WHERE cl.organization_id=:'organization_id'::uuid AND cl.status='DNC'
), candidates AS (
  SELECT *,COALESCE(call_phone,membership_phone) AS normalized_phone,
    CASE WHEN call_phone IS NULL THEN 'review_missing_call_phone'
      WHEN call_phone IS DISTINCT FROM membership_phone THEN 'review_phone_changed'
      ELSE 'review_historical_intent' END AS review_reason
  FROM evidence
)
SELECT transaction_timestamp() AS audited_at,c.*,
  EXISTS (SELECT 1 FROM public.dnc_list d WHERE d.organization_id=c.organization_id
    AND private.phone_digits_e164ish(d.phone_number)=c.normalized_phone) AS already_suppressed,
  (SELECT count(*) FROM public.campaign_leads peer
     LEFT JOIN public.leads l ON l.id=peer.lead_id AND l.organization_id=peer.organization_id
     WHERE peer.organization_id=c.organization_id
       AND COALESCE(peer.status,'Queued') NOT IN ('DNC','Completed','Removed','Failed','removed','Closed Won')
       AND (private.phone_digits_e164ish(peer.phone)=c.normalized_phone
         OR private.phone_digits_e164ish(l.phone)=c.normalized_phone)) AS nonterminal_memberships
FROM candidates c
ORDER BY c.organization_id,c.normalized_phone,c.campaign_lead_id;
COMMIT;
