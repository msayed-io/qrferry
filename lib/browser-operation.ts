/** Keep useful DOMException names even when browsers provide an empty message. */
export function describeBrowserError(error: unknown): string {
  if (error && typeof error === "object") {
    const value = error as { name?: unknown; message?: unknown };
    const name = typeof value.name === "string" ? value.name : "";
    const message =
      typeof value.message === "string" ? value.message.trim() : "";
    if (message)
      return name && name !== "Error" && !message.includes(name)
        ? `${message} (${name})`
        : message;
    if (name) return name;
  }
  return typeof error === "string" && error.trim() ? error : "UnknownError";
}

export class BrowserOperationTimeout extends Error {
  constructor(readonly phase: string) {
    super(`No completion signal: ${phase}`);
    this.name = "BrowserOperationTimeout";
  }
}

/** A deadline bounds waiting, not a claim that the underlying work never completed. */
export function withDeadline<T>(
  promise: Promise<T>,
  phase: string,
  milliseconds: number,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      reject(new BrowserOperationTimeout(phase));
      try {
        onTimeout?.();
      } catch {
        /* Preserve timeout, including already-completed transactions. */
      }
    }, milliseconds);
    promise.then(
      (value) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
