// logSeq — the stored sequence number for the SQLite log ring.
//
// logbus numbers entries from 0 on every boot (its `seq`). The ring keys rows on that
// number and trims the noisy categories relative to the table-wide MAX(seq). A July-2026
// capture left MAX(seq) at ~37k, so from then on every new boot's poll/read rows sat
// below `MAX(seq) - 20000` and were deleted on the very next flush — 812 gaps and 5,595
// missing rows in one 88-minute boot (2026-09-05), which read as "the poll never runs".
//
// The stored seq therefore CONTINUES from the table: base = MAX(seq) + 1 at open, and
// each entry lands at base + its boot-local seq. Monotonic across boots, no collisions,
// and the trim keeps the newest rows as it was written to. PURE, node-testable.
export function seqBaseFrom(maxSeqInDb: number | null | undefined): number {
  return typeof maxSeqInDb === 'number' && Number.isFinite(maxSeqInDb) && maxSeqInDb >= 0 ? maxSeqInDb + 1 : 0;
}

export function storedSeq(base: number, bootSeq: number): number {
  return base + bootSeq;
}
