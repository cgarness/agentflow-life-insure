# Reports V2 context snapshot — November 7, 2026 Pacific

- **Changes:** scoped C-NULL-IDENTITY fix complete; buyer predicate must be explicitly TRUE. Canonical C SQL/boundary tests imported, nullable and valid wrapper regressions added, commission runner and CI paths extended, …31 source/history pins updated. Exact 14-file scope listed before edits.
- **Source:** unchanged main `e2739c26e21f8e159b783ccf59046fed55560b16`; local `fix/reports-c-buyer-identity-20261108`; continuation of draft PR #519. Original frozen `38bd32dbddc21ec6c3d4adbcc8489f06cb64bb7c` remains historical. Exactly …31 and release runner differ among its 36 release files.
- **Production:** latest verified B state: 367 history rows, 11/11 A/B migrations, contract 3.1.0 enabled, empty correction ledger. No new UI or Package C deployment in this turn.
- **Verification:** native PostgreSQL 17.6 / CLI 2.121.0; full commission harness and six C failure boundaries pass; original SQL fails the new regression; full release rehearsal 17/17; all 34 SQL pins pass. Root TypeScript, syntax, whitespace and scope pass. Full logs and limitations retained in verification.md.
- **Decisions:** human review waived, not signed off; Pacific settings retained. No live policy corrections, smoke sales, role simulations or telephony changes. B5/B6 and owner visual/CSV/map acceptance remain open.
- **Migrations/deploys:** none in production. Isolated native test databases only.
- **Next:** publish the correction on existing draft PR #519 and verify final-head hosted CI/previews. Merge and each exact Package C backend stage still require the separately controlled decision; frontend, D/F remain separate.
