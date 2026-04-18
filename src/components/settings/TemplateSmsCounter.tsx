interface TemplateSmsCounterProps {
  content: string;
}

function isUnicodeSms(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && cp > 127) return true;
  }
  return false;
}

function formatSegmentsLabel(segments: number): string {
  const n = segments;
  return `${n} message${n === 1 ? "" : "s"}`;
}

export function TemplateSmsCounter({ content }: TemplateSmsCounterProps) {
  const charCount = [...content].length;
  const unicode = isUnicodeSms(content);
  const segmentSize = unicode ? 70 : 160;
  const segmentLimit = segmentSize;
  const segments = charCount === 0 ? 0 : Math.ceil(charCount / segmentSize);

  let colorClass = "text-muted-foreground";
  if (unicode) {
    if (charCount >= 70) colorClass = "text-destructive";
    else if (charCount >= 60) colorClass = "text-amber-500";
  } else {
    if (charCount >= 160) colorClass = "text-destructive";
    else if (charCount >= 130) colorClass = "text-amber-500";
  }

  return (
    <div className="space-y-1">
      <p className={`text-right text-xs ${colorClass}`}>
        {charCount} / {segmentLimit} · {formatSegmentsLabel(segments)}
      </p>
      {segments > 1 && (
        <p className="text-right text-[10px] font-medium text-amber-600 dark:text-amber-500">
          This will send as {segments} messages — carriers may charge per segment
        </p>
      )}
    </div>
  );
}
