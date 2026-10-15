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
    <tr className="border-t">
      <th scope="row" className="sticky left-0 z-10 min-w-[11rem] bg-card px-3 py-1.5 text-left align-top font-normal">
        <span className="block text-sm text-foreground">{row.variantLabel || "All ages"}</span>
        <span className="block text-xs text-muted-foreground">{row.variantDetail}</span>
      </th>
      {levels.map((level, index) => (
        <td key={level} className="px-1 py-1 text-right">
          {readOnly ? (
            <span className="tabular-nums text-sm text-foreground">{cells[index] === "" ? "—" : cells[index]}</span>
          ) : (
            <input
              aria-label={`${row.variantLabel || "All ages"} at level ${level}`}
              inputMode="decimal"
              value={cells[index]}
              onChange={(event) => onChange?.(row.ref, level, event.target.value)}
              className={cn(
                "h-8 w-16 rounded-md border bg-background px-1.5 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring",
                invalid[index] && "border-destructive ring-1 ring-destructive",
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
const RateMatrix: React.FC<RateMatrixProps> = ({ levels, rows, value, readOnly, onChange, invalidCells }) => {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No products yet.</p>;
  return (
    <div className="max-h-[32rem] overflow-auto rounded-lg border">
      <table className="w-max min-w-full border-collapse text-sm">
        <thead className="sticky top-0 z-20 bg-muted">
          <tr>
            <th scope="col" className="sticky left-0 z-30 bg-muted px-3 py-2 text-left text-xs font-medium text-muted-foreground">
              Variant
            </th>
            {levels.map((level) => (
              <th key={level} scope="col" className="px-1 py-2 text-right text-xs font-medium text-muted-foreground">{level}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <React.Fragment key={row.ref}>
              {row.productHeading && (
                <tr className="border-t bg-muted/40">
                  <th colSpan={levels.length + 1} scope="rowgroup" className="sticky left-0 px-3 py-1.5 text-left text-xs font-semibold text-foreground">
                    {row.productHeading}
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
