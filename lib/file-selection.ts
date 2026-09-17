/** UI batch limit; the wire protocol and existing received libraries are unchanged. */
export const MAX_BATCH_FILES = 3;

export class FileSelectionError extends Error {
  constructor(readonly reason: "count" | "size") {
    super(
      reason === "count"
        ? "Too many files in one batch"
        : "Batch exceeds byte limit",
    );
    this.name = "FileSelectionError";
  }
}

/** Validate the whole selection before modifying anything; never silently truncate files. */
export function planFileSelection<T extends { size: number }>(
  current: readonly T[],
  incoming: readonly T[],
  append: boolean,
  maxBytes: number,
): T[] {
  const next = append ? [...current, ...incoming] : [...incoming];
  if (next.length > MAX_BATCH_FILES) throw new FileSelectionError("count");
  if (next.reduce((total, file) => total + file.size, 0) > maxBytes)
    throw new FileSelectionError("size");
  return next;
}
