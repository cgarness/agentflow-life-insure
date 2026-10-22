/**
 * Timeline legend and fills. Received is solid; both expected parts are hatched (45° Advance, 135° Months 10–12), so
 * recorded money and estimates differ by texture as well as colour. Colours are the validated categorical slots 1–3
 * (light and dark steps), set as CSS variables by the chart container.
 */
const Swatch = ({ kind }: { kind: "received" | "advance" | "later" }) => (
  <svg width="12" height="12" aria-hidden className="shrink-0 rounded-[3px]">
    {kind === "received" ? <rect width="12" height="12" fill="var(--cc-received)" />
      : <rect width="12" height="12" fill={`url(#cc-key-${kind})`} stroke={`var(--cc-${kind})`} />}
  </svg>
);

export function TimelineKey() {
  return (
    <ul aria-label="Timeline key"
      className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground [--cc-advance:#2a78d6] [--cc-later:#eb6834] [--cc-received:#1baf7a] dark:[--cc-advance:#3987e5] dark:[--cc-later:#d95926] dark:[--cc-received:#199e70]">
      <svg width="0" height="0" className="absolute" aria-hidden>
        <defs>
          <pattern id="cc-key-advance" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="4" height="4" fill="var(--cc-advance)" fillOpacity="0.28" /><rect width="1.6" height="4" fill="var(--cc-advance)" />
          </pattern>
          <pattern id="cc-key-later" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(135)">
            <rect width="4" height="4" fill="var(--cc-later)" fillOpacity="0.28" /><rect width="1.6" height="4" fill="var(--cc-later)" />
          </pattern>
        </defs>
      </svg>
      <li className="flex items-center gap-1.5"><Swatch kind="received" />Received</li>
      <li className="flex items-center gap-1.5"><Swatch kind="advance" />Expected · Advance</li>
      <li className="flex items-center gap-1.5"><Swatch kind="later" />Expected · Months 10–12</li>
    </ul>
  );
}
