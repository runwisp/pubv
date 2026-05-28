import { createInterface } from 'node:readline';
import pc from 'picocolors';
import type { Prompt, SelectOption } from '../ports/prompt.js';

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
      const answer = (
        await ask(
          opts,
          `${INDENT}${pc.bold('?')} ${message} ${pc.dim(`[${defaultValue}]`)} ${pc.cyan('›')} `,
        )
      ).trim();
      return answer || defaultValue;
    },

    async select(message, options, defaultKey) {
      return await askSelect(opts, message, options, defaultKey);
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

async function askSelect<K extends string>(
  opts: PromptOptions,
  message: string,
  options: ReadonlyArray<SelectOption<K>>,
  defaultKey: K,
): Promise<K> {
  opts.output.write(`${INDENT}${pc.bold('?')} ${message}\n`);
  for (const o of options) {
    const marker = o.key === defaultKey ? pc.cyan('●') : pc.dim('○');
    opts.output.write(`${INDENT}  ${marker} ${pc.bold(o.key || '(empty)')}  ${pc.dim(o.label)}\n`);
  }
  const hint = pc.dim(`[${defaultKey || '(empty)'}]`);
  const answer = (await ask(opts, `${INDENT}${pc.cyan('›')} ${hint} `)).trim();
  if (!answer) return defaultKey;
  const match = options.find((o) => o.key === answer);
  return match?.key ?? defaultKey;
}
