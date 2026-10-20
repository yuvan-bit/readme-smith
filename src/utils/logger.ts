/**
 * Minimal leveled logger with TTY colour support.
 * Honours NO_COLOR, --quiet and --verbose without pulling in a dependency.
 */

type Level = 'debug' | 'info' | 'warn' | 'error' | 'success' | 'step';

const COLOR_ENABLED =
  !process.env.NO_COLOR &&
  !process.env.CI &&
  (process.stdout.isTTY || process.env.FORCE_COLOR === '1');

const PALETTE: Record<string, [number, number]> = {
  reset: [0, 0],
  dim: [2, 22],
  bold: [1, 22],
  red: [31, 39],
  green: [32, 39],
  yellow: [33, 39],
  blue: [34, 39],
  magenta: [35, 39],
  cyan: [36, 39],
  grey: [90, 39],
};

function paint(color: keyof typeof PALETTE, text: string): string {
  if (!COLOR_ENABLED) return text;
  const [open, close] = PALETTE[color]!;
  return `\u001b[${open}m${text}\u001b[${close}m`;
}

export const c = {
  dim: (t: string) => paint('dim', t),
  bold: (t: string) => paint('bold', t),
  red: (t: string) => paint('red', t),
  green: (t: string) => paint('green', t),
  yellow: (t: string) => paint('yellow', t),
  blue: (t: string) => paint('blue', t),
  magenta: (t: string) => paint('magenta', t),
  cyan: (t: string) => paint('cyan', t),
  grey: (t: string) => paint('grey', t),
};

let verbosity: 'quiet' | 'normal' | 'verbose' = 'normal';

export function setVerbosity(level: 'quiet' | 'normal' | 'verbose'): void {
  verbosity = level;
}

function write(stream: NodeJS.WriteStream, line: string): void {
  stream.write(line + '\n');
}

const SYMBOLS = {
  ok: COLOR_ENABLED ? '✔' : '[ok]',
  warn: COLOR_ENABLED ? '▲' : '[!]',
  err: COLOR_ENABLED ? '✖' : '[x]',
  arrow: COLOR_ENABLED ? '›' : '>',
  bullet: COLOR_ENABLED ? '·' : '-',
};

export const log = {
  debug(msg: string): void {
    if (verbosity === 'verbose') write(process.stderr, `${c.grey('·')} ${c.grey(msg)}`);
  },
  info(msg: string): void {
    if (verbosity !== 'quiet') write(process.stderr, `${c.blue(SYMBOLS.arrow)} ${msg}`);
  },
  /** A numbered phase header, e.g. `1/4 Scanning repository`. */
  step(index: number, total: number, msg: string): void {
    if (verbosity !== 'quiet') {
      write(process.stderr, `\n${c.bold(`${c.cyan(`[${index}/${total}]`)} ${msg}`)}`);
    }
  },
  detail(msg: string): void {
    if (verbosity !== 'quiet') write(process.stderr, `  ${c.grey(SYMBOLS.bullet)} ${msg}`);
  },
  success(msg: string): void {
    write(process.stderr, `${c.green(SYMBOLS.ok)} ${msg}`);
  },
  warn(msg: string): void {
    write(process.stderr, `${c.yellow(SYMBOLS.warn)} ${c.yellow(msg)}`);
  },
  error(msg: string): void {
    write(process.stderr, `${c.red(SYMBOLS.err)} ${c.red(msg)}`);
  },
  /** Raw stdout write — used for machine-readable output (`--stdout`, `--json`).
   *  Deliberately adds no newline so piped content is byte-exact. */
  raw(text: string): void {
    process.stdout.write(text);
  },
  /** A single line to stdout, for human-readable tabular output. */
  line(text: string): void {
    process.stdout.write(text + '\n');
  },
  blank(): void {
    if (verbosity !== 'quiet') write(process.stderr, '');
  },
  /**
   * A progress line that overwrites itself on a TTY and falls back to one line
   * per update when the output is piped or captured in CI.
   */
  progress(msg: string): void {
    if (verbosity === 'quiet') return;
    if (process.stderr.isTTY) process.stderr.write(`\r  ${c.grey(SYMBOLS.bullet)} ${msg}\u001b[K`);
    else write(process.stderr, `  ${c.grey(SYMBOLS.bullet)} ${msg}`);
  },
  /** Close an in-place progress line so the next log entry starts cleanly. */
  endProgress(): void {
    if (verbosity !== 'quiet' && process.stderr.isTTY) process.stderr.write('\n');
  },
};

/** Render a progress-ish line without a spinner dependency. */
export function banner(title: string, subtitle?: string): void {
  if (verbosity === 'quiet') return;
  write(process.stderr, '');
  write(process.stderr, c.bold(c.magenta(`  ${title}`)));
  if (subtitle) write(process.stderr, c.grey(`  ${subtitle}`));
  write(process.stderr, '');
}

export { SYMBOLS };
