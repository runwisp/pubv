import pc from 'picocolors';
import type { Logger, Spinner } from '../ports/logger.js';

const INDENT = '  ';
const RULE_WIDTH = 42;
const KV_KEY_WIDTH = 8;
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL_MS = 80;

export interface LoggerOptions {
  stream: NodeJS.WritableStream;
  isTTY: boolean;
  enableSpinner: boolean;
}

export function createLogger(opts: LoggerOptions): Logger {
  const sym = makeSymbols();
  const write = (line: string) => opts.stream.write(line);
  const writeln = (line = '') => opts.stream.write(`${line}\n`);

  return {
    banner(name, version) {
      writeln();
      writeln(`${INDENT}${pc.bold(pc.cyan(name))}  ${pc.dim(`v${version}`)}`);
    },
    section(name) {
      const rule = pc.dim('─'.repeat(Math.max(0, RULE_WIDTH - name.length - 4)));
      writeln();
      writeln(`${INDENT}${pc.dim('──')} ${pc.bold(name)} ${rule}`);
    },
    ok(message) {
      writeln(`${INDENT}${sym.ok} ${message}`);
    },
    warn(message) {
      writeln(`${INDENT}${sym.warn} ${pc.yellow(message)}`);
    },
    fail(message) {
      writeln(`${INDENT}${sym.fail} ${pc.red(message)}`);
    },
    info(message) {
      writeln(`${INDENT}${pc.cyan('›')} ${message}`);
    },
    line(text) {
      if (text === '') {
        writeln();
        return;
      }
      writeln(`${INDENT}${pc.dim(text)}`);
    },
    kv(key, value, note) {
      const k = pc.dim(key.padEnd(KV_KEY_WIDTH));
      const n = note ? `  ${pc.dim(note)}` : '';
      writeln(`${INDENT}${k}${value}${n}`);
    },
    blank() {
      writeln();
    },
    spinner(message) {
      if (opts.isTTY && opts.enableSpinner) {
        return startActiveSpinner(message, opts.stream, write, sym);
      }
      writeln(`${INDENT}${pc.dim('·')} ${message}…`);
      return passiveSpinner(message, writeln, sym);
    },
  };
}

interface SymbolSet {
  ok: string;
  warn: string;
  fail: string;
}

function makeSymbols(): SymbolSet {
  return {
    ok: pc.green('✓'),
    warn: pc.yellow('⚠'),
    fail: pc.red('✗'),
  };
}

function startActiveSpinner(
  message: string,
  stream: NodeJS.WritableStream,
  write: (s: string) => void,
  sym: SymbolSet,
): Spinner {
  let frame = 0;
  let stopped = false;

  const render = () => {
    write(`\r${INDENT}${pc.cyan(SPINNER_FRAMES[frame % SPINNER_FRAMES.length]!)} ${message}`);
    frame++;
  };

  render();
  const handle = setInterval(render, SPINNER_INTERVAL_MS);
  if (typeof handle.unref === 'function') handle.unref();

  const finish = (mark: string, msg?: string) => {
    if (stopped) return;
    stopped = true;
    clearInterval(handle);
    stream.write(`\r\x1b[2K${INDENT}${mark} ${msg ?? message}\n`);
  };

  return {
    succeed: (msg) => finish(sym.ok, msg),
    fail: (msg) => finish(sym.fail, msg),
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(handle);
      stream.write('\r\x1b[2K');
    },
  };
}

function passiveSpinner(message: string, writeln: (s?: string) => void, sym: SymbolSet): Spinner {
  let stopped = false;
  const finish = (mark: string, msg?: string) => {
    if (stopped) return;
    stopped = true;
    writeln(`${INDENT}${mark} ${msg ?? message}`);
  };
  return {
    succeed: (msg) => finish(sym.ok, msg),
    fail: (msg) => finish(sym.fail, msg),
    stop: () => {
      stopped = true;
    },
  };
}
