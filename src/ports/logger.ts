export interface Spinner {
  /** Stop the spinner and mark success. */
  succeed(message?: string): void;
  /** Stop the spinner and mark failure. */
  fail(message?: string): void;
  /** Stop the spinner without a status mark. */
  stop(): void;
}

export interface Logger {
  banner(name: string, version: string): void;
  section(name: string): void;
  ok(message: string): void;
  warn(message: string): void;
  fail(message: string): void;
  info(message: string): void;
  /** Key/value row, e.g. `last     1.2.0  (note)`. */
  kv(key: string, value: string, note?: string): void;
  blank(): void;
  spinner(message: string): Spinner;
}
