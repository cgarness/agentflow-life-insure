import React, { memo } from "react";
import { cn } from "@/lib/utils";

export interface MatrixRow {
  ref: string;
  /** First row of a product carries its heading ("Term · Carrier · Product"). */
  productHeading?: string;
  variantLabel: string;
  variantDetail: string;
}

interface RateMatrixProps {
  levels: number[];
  rows: MatrixRow[];
  value: (ref: string, level: number) => string;
  readOnly?: boolean;
  onChange?: (ref: string, level: number, text: string) => void;
  /** `${ref}:${level}` keys of cells whose text is not a valid rate. */
  invalidCells?: Set<string>;
  /** Draw the matrix's own rounded border (off when a surrounding section already frames it). */
  framed?: boolean;
}

const cellKey = (ref: string, level: number) => `${ref}:${level}`;

const MatrixRowView = memo(function MatrixRowView({
  row, levels, cells, readOnly, onChange, invalid,
}: {
  row: MatrixRow;
  levels: number[];
  cells: string[];
  readOnly?: boolean;
  onChange?: RateMatrixProps["onChange"];
  invalid: boolean[];
}) {
  return (
    <tr className="group/row border-t border-border/40 transition-colors hover:bg-muted/30 focus-within:bg-primary/[0.04]">
      <th
        scope="row"
        className="sticky left-0 z-10 w-[7.5rem] min-w-[7.5rem] bg-card px-2.5 py-1.5 text-left align-middle font-normal shadow-[inset_-1px_0_0_hsl(var(--border)/0.7)] sm:w-auto sm:min-w-[11rem] sm:px-3"
      >
        <span className="block text-sm font-medium text-foreground">{row.variantLabel || "All ages"}</span>
        <span className="block text-[11px] text-muted-foreground">{row.variantDetail}</span>
      </th>
      {levels.map((level, index) => (
        <td key={level} className="px-0.5 py-1 text-right last:pr-2">
          {readOnly ? (
            cells[index] === "" ? (
              <span className="inline-block w-16 px-1.5 text-sm text-muted-foreground/40">—</span>
            ) : (
              <span className="inline-block w-16 px-1.5 text-sm tabular-nums text-foreground">{cells[index]}</span>
            )
          ) : (
            <input
              aria-label={`${row.variantLabel || "All ages"} at level ${level}`}
              inputMode="decimal"
              placeholder="—"
              value={cells[index]}
              onChange={(event) => onChange?.(row.ref, level, event.target.value)}
              className={cn(
                "h-8 w-16 rounded-md border border-transparent bg-muted/40 px-1.5 text-right text-sm tabular-nums text-foreground transition-colors",
                "placeholder:text-muted-foreground/40 hover:border-border focus:border-primary/60 focus:bg-background focus:outline-none focus:ring-2 focus:ring-ring/30",
                invalid[index] && "border-destructive bg-destructive/10 text-destructive ring-1 ring-destructive hover:border-destructive",
              )}
            />
          )}
        </td>
      ))}
    </tr>
  );
}, (a, b) =>
  a.row.ref === b.row.ref && a.row.variantLabel === b.row.variantLabel && a.row.variantDetail === b.row.variantDetail &&
  a.levels.join() === b.levels.join() && a.readOnly === b.readOnly && a.onChange === b.onChange &&
  a.cells.join("\u0000") === b.cells.join("\u0000") && a.invalid.join() === b.invalid.join());

/**
 * Variants as rows, contract levels (highest first) as columns. A blank cell means no rate (unavailable);
 * "0" is a real zero rate. Values are shown and edited as exact text; nothing is rounded.
 */
const RateMatrix: React.FC<RateMatrixProps> = ({ levels, rows, value, readOnly, onChange, invalidCells, framed = true }) => {
  if (rows.length === 0) return <p className="px-4 py-6 text-center text-sm text-muted-foreground">No products yet.</p>;
  return (
    <div className={cn("max-h-[min(32rem,70vh)] overflow-auto", framed && "rounded-lg border border-border/60")}>
      <table className="w-max min-w-full border-collapse text-sm">
        <thead className="sticky top-0 z-20 bg-muted shadow-[inset_0_-1px_0_hsl(var(--border))]">
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-30 bg-muted px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground shadow-[inset_-1px_0_0_hsl(var(--border)/0.7)]"
            >
              Variant
            </th>
            {levels.map((level) => (
              <th key={level} scope="col" className="px-0.5 py-2 text-right text-xs font-semibold tabular-nums text-foreground/80 last:pr-2">
                <span className="inline-block w-16 px-1.5">{level}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <React.Fragment key={row.ref}>
              {row.productHeading && (
                <tr className="border-t border-border/60 bg-muted/50">
                  <th colSpan={levels.length + 1} scope="rowgroup" className="px-0 py-0 text-left">
                    <span className="sticky left-0 inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-foreground">
                      <span className="h-3 w-0.5 rounded-full bg-primary" aria-hidden />
                      {row.productHeading}
                    </span>
                  </th>
                </tr>
              )}
              <MatrixRowView
                row={row}
                levels={levels}
                cells={levels.map((level) => value(row.ref, level))}
                readOnly={readOnly}
                onChange={onChange}
                invalid={levels.map((level) => invalidCells?.has(cellKey(row.ref, level)) ?? false)}
              />
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default RateMatrix;
