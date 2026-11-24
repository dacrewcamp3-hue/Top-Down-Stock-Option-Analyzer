// Shared batched-concurrency helper.
//
// Several scanners (runScanner, fetchQuickSignal/scanSignals, GapScanner) each walk a
// ticker universe N-at-a-time with the same `for (i += BATCH) { slice; Promise.all(map) }`
// loop. This is the single implementation they share so the throttling/progress logic
// lives in one place instead of three near-identical copies.
//
// Each caller keeps its own semantics via `onBatch` (streaming, progress counting,
// state updates) and its own `size` / `delayMs` — nothing about behavior changes.

export interface BatchOptions<R> {
  /** Tickers processed in parallel per wave. */
  size?: number
  /** Pause between waves, ms. Skipped after the final wave. Yahoo throttle guard. */
  delayMs?: number
  /** Called after each wave with that wave's results and overall progress. */
  onBatch?: (batchResults: R[], done: number, total: number) => void
}

/**
 * Maps `fn` over `items` in parallel waves of `size`.
 * Returns the full, in-order list of every wave's results (including any falsy values,
 * so callers that filter afterward keep doing so).
 */
export async function mapInBatches<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  { size = 3, delayMs = 0, onBatch }: BatchOptions<R> = {},
): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += size) {
    const batch        = items.slice(i, i + size)
    const batchResults = await Promise.all(batch.map(fn))
    results.push(...batchResults)
    onBatch?.(batchResults, Math.min(i + size, items.length), items.length)
    if (delayMs && i + size < items.length) {
      await new Promise(r => setTimeout(r, delayMs))
    }
  }
  return results
}
