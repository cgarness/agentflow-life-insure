/**
 * Chart fills for the timeline: both expected parts are hatched (45° Advance, 135° Months 10–12) so estimates differ from
 * recorded money by texture as well as colour. Colours come from CSS variables set by the chart container.
 */
/** Returned as a plain <defs> element: Recharts renders SVG elements placed in a chart, not custom components. */
export function timelinePatterns() {
  return (
    <defs>
      <pattern id="cc-hatch-advance" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" fill="var(--cc-advance)" fillOpacity="0.28" />
        <rect width="2.5" height="6" fill="var(--cc-advance)" />
      </pattern>
      <pattern id="cc-hatch-later" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(135)">
        <rect width="6" height="6" fill="var(--cc-later)" fillOpacity="0.28" />
        <rect width="2.5" height="6" fill="var(--cc-later)" />
      </pattern>
    </defs>
  );
}
