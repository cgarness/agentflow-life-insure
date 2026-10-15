# Superseded 2026-10-14 measurements (kept for the record; not valid user-visible results)

These four summaries are the first fixture runs (2026-10-14). They were replaced on 2026-10-15 (plan §13 and §14) for three reasons:

- **The times are rendering times, not visibility times.** "Painted" meant the first frame after the text entered the surface's DOM. Nothing checked that a person could see it: size, clipping, the viewport or a covering element.
  - On base Conversations this under-reports the wait. The text renders after about 1.79 s, but smooth scrolling only brings it into view after about 2.48 s.
- **The 390×844 rows are not user-visible measurements.** They used Enter in the composer because Send could not be clicked. The text was never visible at that width on either build. Mobile validation is BLOCKED by the pre-existing desktop-only layouts (plan §13.3).
- **Base's "first visible change" was a DOM change, not a visible one.** In base Conversations its Send spinner sat under the previous send's success toast.

Use `../base-x1.json`, `../base-x4.json`, `../candidate-x1.json` and `../candidate-x4.json` instead. In those, desktop results are user-visible and the 390×844 runs are recorded as BLOCKED.
