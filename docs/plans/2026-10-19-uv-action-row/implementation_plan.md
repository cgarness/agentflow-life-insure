# Agent profile action row

Chris requested this UI change on October 18 at 22:12 PDT: move UV actions to the right beside the profile edit action and remove the duplicate settings action. This request authorizes implementation and release within the ongoing approved frontend work.

Files: ProfileHero.tsx (optional action slot, aligned 44px edit button, remove Profile settings); AgentProfileTab.tsx (move existing UV component into hero slot); browser af-subject.tsx (render the real hero for visual verification); this plan and WORK_LOG.md. Preserve existing UV access guards, verified badge, URL/copy behavior, emerald styles and Settings wizard. No backend, data, A2P or other feature changes.

Verify existing focused tests, root TypeScript, scoped lint and whitespace; inspect desktop/mobile rendering with existing fixture. Publish exact reviewed tree in a PR, normal merge without protection overrides, then confirm production ready and served changes. Recovery is a frontend revert.
