export interface SelectOption<K extends string> {
  key: K;
  label: string;
}

export interface Prompt {
  confirm(message: string, defaultYes: boolean): Promise<boolean>;
  /**
   * Free-text input. Returns the default value when the user just presses ENTER.
   */
  input(message: string, defaultValue: string): Promise<string>;
  select<K extends string>(
    message: string,
    options: ReadonlyArray<SelectOption<K>>,
    defaultKey: K,
  ): Promise<K>;
}
