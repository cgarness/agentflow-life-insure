# Timers that outlive the component that started them

Found on November 24, 2026 while tracing the intermittent "New unhandled runtime error" failures of the Reports frontend verification check on draft pull request [cgarness/agentflow-life-insure#536](https://github.com/cgarness/agentflow-life-insure/pull/536). Each timer is the same on `main` (`83a0ed5`), on that pull request's base (`d85434f`), in the released contact work (`2128bb6`) and on the Automations V2 branch. Pull request 536 changes none of them. Each fix needs its own approval. `TwilioContext.tsx` stays as released until then.

## What happens

Vitest's jsdom environment uses Node's own timers, so tearing down the environment does not cancel them. When a test file ends with one of these timers still pending, it can fire after the jsdom teardown and before the worker process exits. The callback sets React state, React reads `window.event`, and the call throws `ReferenceError: window is not defined`. Vitest records this as an unhandled error. `scripts/verify_reports_frontend.py` then fails whenever the branch's run records one that the base run did not.

In the app, the timer's work runs once more after the page or dialer has closed, and React ignores the state update. The Twilio interval keeps ticking until the page reloads.

| Code | Timer | Test file that can leave it pending | Proposed fix |
| --- | --- | --- | --- |
| `src/pages/DialerPage.tsx` | The trusted stats refresh, 3 s after a save (three call sites) and 4 s after a hang-up | `src/pages/__tests__/dialerAppointmentSave.test.tsx` | [`dialer-stats-refresh-timers.patch`](dialer-stats-refresh-timers.patch) |
| `src/components/layout/FloatingDialer.tsx` | The 300 ms search debounce after typing a number | `src/components/layout/__tests__/floatingDialerRecentStates.test.tsx` | [`floating-dialer-search-timer.patch`](floating-dialer-search-timer.patch) |
| `src/contexts/TwilioContext.tsx` | The 1 s call-duration interval started while dialing or on accept | `src/contexts/__tests__/twilioProviderLifecycle.test.tsx`, `src/contexts/__tests__/teamOpenRevealIntegration.test.tsx` | [`twilio-call-duration-timer.patch`](twilio-call-duration-timer.patch) |

## Evidence

- **Dialer page.** Of four full runs on two cores (`--maxWorkers=2`, as in CI), one recorded this error from `DialerPage.tsx:1125`, attributed to `dialerAppointmentSave.test.tsx`. A second check ran that file alone, without instrumentation: no errors in 15 unloaded runs, and one in 15 runs with a busy loop on the same two cores. The file's last saves finish 1.3 to 2.5 s before it ends, so their 3 s timers are pending at every teardown. With the scratch environment below it appears every time: 4 errors while all 34 tests pass. With the patch there are none, and the five test files that render the Dialer page pass (62 tests). ESLint reports the same 7 warnings and the app typecheck the same 78 diagnostics as before.
- **Floating dialer.** Under two busy loops, 2 of 6 unmodified invocations recorded one error each. With the patch there are 0 in 6. The eight test files that touch `FloatingDialer` pass (104 tests).
- **TwilioContext.** Six tests in `twilioProviderLifecycle.test.tsx` and four in `teamOpenRevealIntegration.test.tsx` end mid-call. With the worker held open after teardown, they record 13 errors together, and the base records the same. With the patch there are 0, and those files pass (48 tests). The 24 test files that reference `TwilioContext` give the same result with and without it: 328 tests pass, and `contactName.test.ts` fails to load either way, as it does on the base without a Supabase URL. The 45 s phone-presence heartbeat is the only interval left, and nothing in these tests keeps it pending.

## Reproduce

A natural run on two cores, as in CI:

```bash
VITEST_RUNTIME_ERROR_FILE=/tmp/rt.json taskset -c 0,1 npx --no-install vitest run --maxWorkers=2 --minWorkers=1 --reporter=default --reporter=$PWD/scripts/vitest-runtime-error-reporter.mjs
```

`/tmp/rt.json` lists any unhandled error. Expect it in a minority of runs.

To make it happen every time, save this scratch-only environment as `src/__repro__/slowExitJsdom.ts`. Do not commit it. It is the standard jsdom environment plus a 4 s pause after the teardown, as when a loaded runner's worker is slow to exit:

```ts
import { builtinEnvironments } from "vitest/environments";
import type { Environment } from "vitest/environments";
const base = builtinEnvironments.jsdom;
export default <Environment>{
  name: "slow-exit-jsdom",
  transformMode: "web",
  async setup(global, options) {
    const env = await base.setup(global, options);
    return { async teardown(g) { await env.teardown(g); await new Promise(r => setTimeout(r, 4000)); } };
  },
};
```

Then run one test file with it:

```bash
VITEST_RUNTIME_ERROR_FILE=/tmp/rt.json npx --no-install vitest run --maxWorkers=1 --minWorkers=1 --environment=./src/__repro__/slowExitJsdom.ts --reporter=default --reporter=$PWD/scripts/vitest-runtime-error-reporter.mjs src/pages/__tests__/dialerAppointmentSave.test.tsx
```

For the Dialer page this records four errors without the patch and none with it. Apply a patch with `git apply docs/plans/2026-11-24-test-teardown-timers/<name>.patch`.

## Fix shape

Each patch clears its timer when the component unmounts. The Dialer patch also tracks the four delayed refreshes in a set, and makes `reconcileTrustedStats` update nothing once the page has closed. Behavior while the page or dialer is open is unchanged: the same refreshes and searches run at the same delays. A second variant of the TwilioContext cleanup also clears the end-of-call reset timeout (`endResetRef`). Neither variant has been reviewed for production yet.
