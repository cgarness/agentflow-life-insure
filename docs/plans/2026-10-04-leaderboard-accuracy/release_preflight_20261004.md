# Release preflight — permission amendment approved

**05:46 PDT update:** Chris explicitly approved removing anonymous execution while preserving signed-in access. The unapplied migration now verifies the exact observed ACL before the explicit revocation. Its fixture starts with the actual anonymous grant; embedded tests pass for exact post-ACL, anonymous invocation denial (even with a forged user claim), authenticated access and Admin self-scoping. This resolves the permission decision, not the remaining CI/deployment gates.

Chris approved proceeding after the implementation/release-packet handoff on October 4, 2026 at 05:35 PDT. No publication or production action followed before the checks below.

## Read-only checks

- Fresh `origin/main` remains `436d9d840732bca1262559597c17e5ef09893fbf`; isolated head is `57a5361b`.
- At `2026-10-04T12:37:08Z`, production reported zero recent active calls and zero active Dialer sessions. This observation expires and must be repeated immediately before any eventual backend work.
- Production still has eight clients and six sale events in the audited organization. None of the eight prepared reporting migrations is applied.
- Existing function definitions match the expected source hashes; the permission mismatch below blocks the prepared release despite unchanged source.

## Blocking mismatch

`public.get_trusted_today_dialer_stats(uuid,timestamptz,timestamptz)` has definition MD5 `477390a34331c7f0c19389a12e383374`, owner `postgres`, SECURITY DEFINER, and live ACL:

```text
{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
```

Prepared migration `20261004062224_trusted_dialer_canonical_counts.sql` rejects any anonymous EXECUTE grant and says it preserves existing permissions. Its fixture first revokes anonymous access, so passing local tests did not establish compatibility with this live ACL. This is a release-preflight correction, not evidence that production permissions changed during the task.

The release packet explicitly requires stopping on permission/preimage mismatch. No guard was changed or bypassed, and no grant was revoked.

## Narrow amendment — approved at 05:46 PDT

Recommended: verify the exact observed live ACL, explicitly revoke `anon`/`PUBLIC` EXECUTE on this trusted reader, preserve `postgres`, `authenticated` and `service_role` access, and test anonymous denial plus signed-in role behavior against the actual baseline. Amend the unapplied migration, fixture, hash inventory and release record only after Chris approves this specific permission change, then run the outstanding native/browser/full-CI gates.

Alternative: preserve the exact existing ACL and amend/test only the precondition and reporting body. Do not choose between these permission contracts implicitly.

Production is untouched. No public push, PR, merge, migration, historical repair, Edge deployment, frontend release, provider request or customer communication occurred in this release attempt.
