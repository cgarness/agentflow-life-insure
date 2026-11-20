# Sticky Contact Numbers — agency activation closeout

November 20, 2026 Pacific. Activated at **11:01:17 AM Pacific / 19:01:17 UTC**.

## Outcome and scope

**Sticky voice and SMS behavior are enforced for Family First Life - Chris Garness only**, organization `a0000000-0000-0000-0000-000000000001`, in AGENTFLOW CRM (`jncvvsvckxhqgqvkppmj`). This carries out Chris's instruction, “Let’s enable the sticky behavior,” using the installed feature's native reconciliation and activation functions. The other five organizations remain off and have no affinity rows created by this operation.

The earlier installation record accurately describes the system before activation. Its all-off status is historical; this record is the current activation outcome. No installer, migration, Edge Function or frontend deployment was repeated.

## Exact data operation and guards

One bounded transaction applied the settled six disposition classifications, preserved the two existing fixed ClearPath alert routes through a private allowlist, ran native reconciliation in seven pages of at most 500 endpoints, and enabled both channels only after the native completion gate passed. The dry run and applied result agreed. No completion marker, provider evidence or historical voice binding was fabricated.

The reviewed operation is `supabase/ops/sticky_numbers_activate_cg_financial_20261120.sql`: **25,396 bytes**, SHA-256 `ba41c860604f745cb5c8be07d33ed9cf7396aac87979e360c33bf6262f07a8a1`. This is an applied operations receipt, not a new migration or an instruction to repeat the operation.

Guards checked the installed 55 function fingerprints, target and other-organization modes, exact disposition configuration, fixed alert identities, expected reconciliation totals, unchanged communication counts and new call-row activity before enforcement. Three-second lock and sixty-second statement limits were retained. The operation committed atomically at `2026-11-20T19:01:17.442423+00:00`.

The transition was **off directly to enforced**, supported by the installed native gate after completed reconciliation. No idle shadow period or production shadow-comparison pass is claimed.

## Reconciliation result

The identity unit is an organization plus normalized recipient phone, so these counts are endpoints rather than contact-record counts.

| Final endpoint state | Count | Meaning |
|---|---:|---|
| Established SMS identity | 2 | Trusted existing evidence identifies one sender |
| Needs review | 44 | History is ambiguous or lacks the required verification |
| Unassigned | 3,137 | Reconciled without inventing a prior relationship |
| **Total reconciled** | **3,183** | Native reconciliation reports complete |

All voice states remain unassigned. No historical voice identity was manufactured from browser-leg duration, unverified calls or missing override/binding proof. Future voice establishment continues to require the installed provider-evidence and disposition rules.

There are 3,183 affinity rows and 3,183 corresponding audit events, one reconciliation record, one settings row and one enforcement row for the target organization. The 44 review endpoints remain protected; activation did not choose a sender for them. Review reasons include unverified message history, missing historical conversation binding/override proof, and multiple historical SMS senders. Reasons overlap, so their individual reason counts must not be added as unique recipients. The saved review list contains 44 unique endpoints.

At readback, all **22 agency numbers** passed the current database readiness checks for voice and SMS. This did not register, purchase, release or reconfigure any number. Actual SMS handoff still performs the existing readiness and live provider checks.

## Dispositions and fixed internal alerts

The six existing disposition IDs were checked and classified according to the settled product mapping:

| Disposition | Affinity class |
|---|---|
| Appointment Set | confirmed |
| Call Back | confirmed |
| Sold | confirmed |
| No Answer | excluded |
| Not Interested | excluded |
| DNC | excluded |

Classification does not rewrite call outcomes, reporting duration, consent, DNC or suppression data. No custom disposition was promoted implicitly.

The private allowlist contains exactly two existing ClearPath routes, with prefixes `clearpath:lead:` and `clearpath:test:` and their fixed organization, sender and recipient. Read-only checks accepted the intended routes and rejected wrong purpose and wrong recipient. No test alert was sent, and the ClearPath function remains unchanged. The allowlist does not grant arbitrary callers or customer messages an exemption.

## Deployment identity and authenticated preview

Activation used the already installed production code:

| Component | Preserved identity |
|---|---|
| Database | 386 migrations; head `20261120060345` |
| Edge functions | SMS 62; workflow 51; confirmation worker 27; SMS webhook 48; inbound voice 73; all `verify_jwt=false` |
| ClearPath | Version 25, unchanged |
| Frontend | `f49e55b770b97155fac46f3e5eeae949ad9f3047` |
| Primary deployment | `dpl_56mpNPZEL3gNBBAqbHga3Es5Gq7f`, READY, `agentflow` |
| Live domains | `fflagent.com`, `www.fflagent.com`; apex redirect preserved |
| Main | `2129fa8b195cee77ad75f614abe655facfad2725`, unmerged |

After reload, the authenticated contact screen displayed **Calls, Texts, Change and Ready**. No Call, Send, Change or Save action was performed. Backend aggregate logs record **19 POST requests** to `/rest/v1/rpc/preview_contact_numbers`, all **HTTP 200**, during `19:01:17–19:06:41 UTC`.

The post-UI database readback at `19:06:08 UTC` retained 3,183 assignments and events, 76 messages, 18 dispatches, zero call bindings and zero bound dispatches, with the same endpoint states and modes. This supports the read-only preview result. No console-error inspection is claimed for this activation checkpoint, and no real voice/media or SMS delivery test was performed.

## Advisors and practical limits

The before/after activation advisor comparison found **no new security, performance or health findings**. Security and health findings were unchanged. One unused-index informational finding for `affinity_recruit_phone` resolved after use; existing errors and warnings remain disclosed. This is a delta comparison, not a clean-security-report claim.

The installed voice authorization **still blocks a number at its configured daily call cap**. None of the 22 current numbers was at its cap in the preflight. Activation did not implement or verify a soft-cap bypass for pinned callers; do not describe that behavior as shipped.

Existing isolated and hosted verification remains applicable to the unchanged runtime, with its recorded TypeScript/test and mobile limitations. Successful activation and a read-only screen check do not replace controlled real-call/text acceptance.

## Preserved boundaries and next use

No real call or text, provider/number change, secondary-project operation, main merge, runtime redeployment, schema edit, arbitrary permanent sender choice, consent/suppression change or resend occurred. Browser tabs should be refreshed before normal use so the enabled controls load.

The 44 review endpoints need deliberate resolution from their evidence; this operation did not guess their sender or clear their review state. Preserve the current assignments and audit trail. If a protective rollback is later required, use the supported `guard_only` transition for this organization; do not reset enforced identities to off/rotation or replay uncertain sends.

Evidence: the activation approval/plan, reviewed SQL/hash, projected-impact and native dry-run output, execution receipt, immediate and final readbacks, fixed-route checks, review list, readiness snapshot, advisor comparison, authenticated browser observation and preview API aggregate logs are retained in the November 20 activation evidence package.
