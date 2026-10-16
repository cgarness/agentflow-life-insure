import { formatEffectiveDate } from "@/lib/commission/calculator";

/** Small display helpers shared by the Commission Grids settings components. */
export const levelRange = (levels: number[]) =>
  levels.length === 0 ? "No levels" : levels.length === 1 ? `Level ${levels[0]}` : `Levels ${levels[0]}–${levels[levels.length - 1]}`;

export const effective = (isoDate: string) => `Effective ${formatEffectiveDate(isoDate)}`;

export function lastEdited(updatedAt: string, updatedByName: string | null): string {
  const when = new Date(updatedAt);
  const date = Number.isNaN(when.getTime())
    ? updatedAt
    : when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return updatedByName ? `Last edited by ${updatedByName} · ${date}` : `Last updated ${date}`;
}

export const errorMessage = (error: unknown) =>
  error instanceof Error && error.message ? error.message : "Something went wrong. Try again.";
