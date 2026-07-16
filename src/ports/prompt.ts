export interface SelectOption<K extends string> {
  key: K;
  label: string;
}

/**
 * Optional trailing "custom…" entry for {@link Prompt.select}. When chosen, the
 * user is asked to type a free-text value, which `select` returns verbatim
 * (i.e. a value that is not one of the predefined option keys).
 */
export interface SelectCustom {
  /** Row label shown in the option list, e.g. `'custom prefix…'`. */
  label: string;
  /** Free-text prompt shown after the custom row is chosen. */
  prompt: string;
}

export interface Prompt {
  confirm(message: string, defaultYes: boolean): Promise<boolean>;
  /**
   * Free-text input. Returns the default value when the user just presses ENTER.
   */
  input(message: string, defaultValue: string): Promise<string>;
  /**
   * Pick one of `options` (arrow-key navigation on a TTY, numbered entry when
   * piped). Returns the chosen option's `key`, or — when `custom` is provided
   * and its row is chosen — the free-text string the user typed.
   */
  select<K extends string>(
    message: string,
    options: ReadonlyArray<SelectOption<K>>,
    defaultKey: K,
    custom?: SelectCustom,
  ): Promise<K | string>;
}
