/**
 * Read every row of a filtered list without ever presenting a truncated result as
 * complete (plan rev 1, R4).
 *
 * - Keyset paging on `id` (ascending), so a row is never skipped or repeated by an
 *   offset that moved under concurrent writes.
 * - Completeness is decided by the server, never by page length: the first page asks
 *   for an exact count, and a page shorter than requested (a server row limit below our
 *   page size) simply continues. The read is complete only when an empty page proves
 *   there is nothing after the last id, or the exact count has been reached.
 * - At the cap the read stops and reports `complete: false` with the server's total.
 * - A returned error is a failure (never an empty or partial result).
 */
import { assertNoQueryError } from "@/lib/dashboard-contact-identity";

export interface ExactReadResult<T> {
  rows: T[];
  /** The server's exact row count at the first page, or `null` when it was not returned. */
  total: number | null;
  /** True only when every row was read. */
  complete: boolean;
}

export interface ExactPageResult<T> {
  data: T[] | null;
  error: unknown;
  count?: number | null;
}

export interface ExactReadOptions {
  /** Diagnostic label for a failed read. */
  context: string;
  pageSize?: number;
  /** Most rows ever read. */
  cap?: number;
  /** Called before every page after the first (e.g. `assertPageActive`). */
  beforeFollowOn?: () => void;
}

export const EXACT_READ_PAGE_SIZE = 1000;

/**
 * @param page reads rows ordered by `id` ascending, with `id > afterId` when `afterId`
 *   is given, at most `limit` rows, and an exact count when `withCount` is true.
 */
export async function readAllExact<T extends { id: string }>(
  page: (afterId: string | null, limit: number, withCount: boolean) => PromiseLike<ExactPageResult<T>>,
  { context, pageSize = EXACT_READ_PAGE_SIZE, cap = Number.POSITIVE_INFINITY, beforeFollowOn }: ExactReadOptions,
): Promise<ExactReadResult<T>> {
  const rows: T[] = [];
  const ids = new Set<string>();
  let total: number | null = null;
  let afterId: string | null = null;
  let first = true;
  let exhausted = false;

  while (rows.length < cap) {
    if (!first) beforeFollowOn?.();
    const limit = Math.min(pageSize, cap - rows.length);
    const result = await page(afterId, limit, first);
    assertNoQueryError(context, result);
    if (first) total = typeof result.count === "number" ? result.count : null;
    first = false;

    const data = result.data ?? [];
    if (data.length === 0) {
      exhausted = true;
      break;
    }
    let added = 0;
    for (const row of data) {
      if (ids.has(row.id)) continue;
      ids.add(row.id);
      rows.push(row);
      added += 1;
    }
    // A page of nothing new means the keyset did not advance: stop, and say incomplete.
    if (added === 0) break;
    afterId = data[data.length - 1].id;
    if (total !== null && rows.length >= total) {
      exhausted = true;
      break;
    }
  }

  return { rows, total, complete: exhausted };
}
