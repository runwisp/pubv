import { type Key, createInterface, emitKeypressEvents } from 'node:readline';
import pc from 'picocolors';
import type { Prompt, SelectCustom, SelectOption } from '../ports/prompt.js';

const INDENT = '  ';

export interface PromptOptions {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
}

export function createPrompt(opts: PromptOptions): Prompt {
  return {
    async confirm(message, defaultYes) {
      const hint = defaultYes ? pc.dim('[Y/n]') : pc.dim('[y/N]');
      const answer = (
        await ask(opts, `${INDENT}${pc.bold('?')} ${message} ${hint} ${pc.cyan('›')} `)
      )
        .trim()
        .toLowerCase();
      if (!answer) return defaultYes;
      return answer === 'y' || answer === 'yes';
    },

    async input(message, defaultValue) {
      const hint = pc.dim(`[${defaultValue}]`);
      const answer = (
        await ask(opts, `${INDENT}${pc.bold('?')} ${message} ${hint} ${pc.cyan('›')} `)
      ).trim();
      return answer || defaultValue;
    },

    async select(message, options, defaultKey, custom) {
      return await askSelect(opts, message, options, defaultKey, custom);
    },
  };
}

function ask(opts: PromptOptions, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: opts.input, output: opts.output });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/** Display text for an option key; the empty prefix renders as `(empty)`. */
function keyLabel(key: string): string {
  return key || '(empty)';
}

/** A rendered row: either a predefined option or the trailing custom entry. */
type Row<K extends string> = { kind: 'option'; key: K; label: string } | { kind: 'custom' };

function buildRows<K extends string>(
  options: ReadonlyArray<SelectOption<K>>,
  custom: SelectCustom | undefined,
): Array<Row<K>> {
  const rows: Array<Row<K>> = options.map((o) => ({ kind: 'option', key: o.key, label: o.label }));
  if (custom) rows.push({ kind: 'custom' });
  return rows;
}

async function askSelect<K extends string>(
  opts: PromptOptions,
  message: string,
  options: ReadonlyArray<SelectOption<K>>,
  defaultKey: K,
  custom?: SelectCustom,
): Promise<K | string> {
  const input = opts.input as NodeJS.ReadStream;
  const interactive = Boolean(input.isTTY) && typeof input.setRawMode === 'function';
  return interactive
    ? await selectInteractive(opts, message, options, defaultKey, custom)
    : await selectNumbered(opts, message, options, defaultKey, custom);
}

/** Arrow-key selector for real terminals. */
async function selectInteractive<K extends string>(
  opts: PromptOptions,
  message: string,
  options: ReadonlyArray<SelectOption<K>>,
  defaultKey: K,
  custom?: SelectCustom,
): Promise<K | string> {
  const input = opts.input as NodeJS.ReadStream;
  const out = opts.output;
  const rows = buildRows(options, custom);
  const defaultIdx = Math.max(
    0,
    rows.findIndex((r) => r.kind === 'option' && r.key === defaultKey),
  );

  out.write(`${INDENT}${pc.bold('?')} ${message}  ${pc.dim('(↑/↓, enter)')}\n`);

  const render = (active: number, initial: boolean): void => {
    if (!initial) out.write(`\x1b[${rows.length}A`); // cursor up to the first row
    rows.forEach((row, i) => {
      const on = i === active;
      const cursor = on ? pc.cyan('❯') : ' ';
      const text =
        row.kind === 'custom'
          ? pc.italic(custom!.label)
          : `${pc.bold(keyLabel(row.key))}  ${pc.dim(row.label)}`;
      const line = on ? pc.cyan(text) : text;
      out.write(`\x1b[2K${INDENT}${cursor} ${line}\n`); // clear line, then draw
    });
  };

  emitKeypressEvents(input);
  const wasRaw = input.isRaw ?? false;
  input.setRawMode?.(true);
  input.resume();

  let active = defaultIdx;
  render(active, true);

  const chosen: number = await new Promise<number>((resolve) => {
    const onKey = (_str: string, key: Key): void => {
      if (key.name === 'up' || key.name === 'k') {
        active = (active - 1 + rows.length) % rows.length;
        render(active, false);
      } else if (key.name === 'down' || key.name === 'j') {
        active = (active + 1) % rows.length;
        render(active, false);
      } else if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        resolve(active);
      } else if ((key.ctrl && key.name === 'c') || key.name === 'escape') {
        cleanup();
        // Restore the terminal, then exit as if interrupted.
        out.write('\n');
        process.exit(130);
      }
    };
    const cleanup = (): void => {
      input.removeListener('keypress', onKey);
      input.setRawMode?.(wasRaw);
      input.pause();
    };
    input.on('keypress', onKey);
  });

  const row = rows[chosen]!;
  if (row.kind === 'custom') {
    return await askCustom(opts, custom!);
  }
  return row.key;
}

/** Numbered fallback for piped / non-TTY input (also keeps CI usable). */
async function selectNumbered<K extends string>(
  opts: PromptOptions,
  message: string,
  options: ReadonlyArray<SelectOption<K>>,
  defaultKey: K,
  custom?: SelectCustom,
): Promise<K | string> {
  const out = opts.output;
  const rows = buildRows(options, custom);
  const defaultIdx = Math.max(
    0,
    rows.findIndex((r) => r.kind === 'option' && r.key === defaultKey),
  );

  out.write(`${INDENT}${pc.bold('?')} ${message}\n`);
  rows.forEach((row, i) => {
    const marker = i === defaultIdx ? pc.cyan('●') : pc.dim('○');
    const text =
      row.kind === 'custom'
        ? pc.italic(custom!.label)
        : `${pc.bold(keyLabel(row.key))}  ${pc.dim(row.label)}`;
    const num = pc.dim(`${i + 1})`);
    out.write(`${INDENT}  ${num} ${marker} ${text}\n`);
  });

  const hint = pc.dim(`[${defaultIdx + 1}]`);
  const answer = (await ask(opts, `${INDENT}${pc.cyan('›')} ${hint} `)).trim();

  let idx = defaultIdx;
  if (answer) {
    const n = Number.parseInt(answer, 10);
    if (Number.isInteger(n) && n >= 1 && n <= rows.length) idx = n - 1;
  }

  const row = rows[idx]!;
  if (row.kind === 'custom') {
    return await askCustom(opts, custom!);
  }
  return row.key;
}

/** Read a free-text custom value, rejecting whitespace (matches --tag-prefix). */
async function askCustom(opts: PromptOptions, custom: SelectCustom): Promise<string> {
  for (;;) {
    const value = (
      await ask(opts, `${INDENT}${pc.bold('?')} ${custom.prompt} ${pc.cyan('›')} `)
    ).trim();
    if (!/\s/.test(value)) return value;
    opts.output.write(`${INDENT}${pc.red('✗')} must not contain whitespace\n`);
  }
}
