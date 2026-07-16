import { describe, expect, test } from 'bun:test';
import { PassThrough, Writable } from 'node:stream';
import { createPrompt } from '../../src/adapters/prompt-readline.js';
import type { SelectOption } from '../../src/ports/prompt.js';

const OPTIONS: ReadonlyArray<SelectOption<string>> = [
  { key: 'v', label: 'v1.2.3' },
  { key: '', label: '1.2.3 (no prefix)' },
];
const CUSTOM = { label: 'custom prefix…', prompt: 'enter tag prefix' };

/** A readable stream that impersonates a TTY (or not) for the selector. */
function makeInput(isTTY: boolean): PassThrough & { isTTY?: boolean } {
  const s = new PassThrough() as PassThrough & {
    isTTY?: boolean;
    isRaw?: boolean;
    setRawMode?: (v: boolean) => void;
  };
  s.isTTY = isTTY;
  s.isRaw = false;
  s.setRawMode = (v: boolean) => {
    s.isRaw = v;
  };
  return s;
}

function makeOutput(): { stream: Writable; text: () => string } {
  let text = '';
  const stream = new Writable({
    write(chunk, _enc, cb) {
      text += chunk.toString();
      cb();
    },
  });
  return { stream, text: () => text };
}

/** Yield a macrotask so the selector attaches its listeners / readline. */
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

describe('createPrompt().select — interactive (TTY)', () => {
  test('arrow-down + enter reaches the empty (no-prefix) row', async () => {
    const input = makeInput(true);
    const output = makeOutput();
    const prompt = createPrompt({ input, output: output.stream });

    const p = prompt.select('tag prefix?', OPTIONS, 'v');
    await tick();
    input.emit('keypress', '', { name: 'down' });
    input.emit('keypress', '', { name: 'return' });

    expect(await p).toBe('');
  });

  test('enter on the default row returns the default', async () => {
    const input = makeInput(true);
    const output = makeOutput();
    const prompt = createPrompt({ input, output: output.stream });

    const p = prompt.select('tag prefix?', OPTIONS, 'v');
    await tick();
    input.emit('keypress', '', { name: 'return' });

    expect(await p).toBe('v');
  });

  test('up wraps to the last row (custom) and reads a free-text value', async () => {
    const input = makeInput(true);
    const output = makeOutput();
    const prompt = createPrompt({ input, output: output.stream });

    const p = prompt.select('tag prefix?', OPTIONS, 'v', CUSTOM);
    await tick();
    input.emit('keypress', '', { name: 'up' }); // wrap from row 0 → custom row
    input.emit('keypress', '', { name: 'return' });
    await tick();
    input.write('myapp.\n');

    expect(await p).toBe('myapp.');
  });
});

describe('createPrompt().select — numbered fallback (non-TTY)', () => {
  test('typing a number selects that row', async () => {
    const input = makeInput(false);
    const output = makeOutput();
    const prompt = createPrompt({ input, output: output.stream });

    const p = prompt.select('tag prefix?', OPTIONS, 'v');
    await tick();
    input.write('2\n');

    expect(await p).toBe('');
  });

  test('empty input returns the default', async () => {
    const input = makeInput(false);
    const output = makeOutput();
    const prompt = createPrompt({ input, output: output.stream });

    const p = prompt.select('tag prefix?', OPTIONS, 'v');
    await tick();
    input.write('\n');

    expect(await p).toBe('v');
  });

  test('choosing the custom row reads a free-text value', async () => {
    const input = makeInput(false);
    const output = makeOutput();
    const prompt = createPrompt({ input, output: output.stream });

    const p = prompt.select('tag prefix?', OPTIONS, 'v', CUSTOM);
    await tick();
    input.write('3\n');
    await tick();
    input.write('myapp.\n');

    expect(await p).toBe('myapp.');
  });
});
