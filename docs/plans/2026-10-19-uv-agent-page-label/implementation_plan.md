# View Agent Page label

Chris explicitly approved replacing View UV Page with View Agent Page on October 18 at 22:00 PDT. Change both enabled and disabled labels in the shared PublicProfileActions component, plus existing test/browser selectors. Preserve the soft emerald styles, Underwriter Verified section heading, Copy Link action, URLs and all behavior.

Files: PublicProfileActions.tsx; uvProfile.test.tsx; uvVerificationWizard.test.tsx; browser/verify.mjs; WORK_LOG.md; this scoped plan. Verify existing focused tests, root TypeScript, scoped lint, build preview and live served label. No new tests or unrelated regression expansion for this text-only change. Release by normal PR merge without overriding repository protections; recovery is a frontend revert.
