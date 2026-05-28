import { PubvError } from './errors.js';

export interface Section {
  /** Either `Unreleased` (case-preserved from source) or a version string like `1.2.3`. */
  version: string;
  /** ISO date `YYYY-MM-DD`, or `null` if the heading carries no date. */
  date: string | null;
  /** Verbatim lines between this heading and the next (link refs at file tail excluded). */
  body: string[];
}

export interface LinkRef {
  name: string;
  url: string;
}

export interface Changelog {
  /** Lines before the first `## [...]` heading. */
  header: string[];
  unreleased: Section | null;
  /** Versioned sections, in source order (newest first by convention). */
  releases: Section[];
  /** Trailing `[name]: url` references, in source order. */
  links: LinkRef[];
  eol: '\n' | '\r\n';
}

export interface ReleaseOptions {
  version: string;
  /** `YYYY-MM-DD`. */
  date: string;
  /** The new `[Unreleased]: <url>` value. */
  unreleasedUrl: string;
  /** The new `[<version>]: <url>` value. */
  versionUrl: string;
}

const LINK_REF_RE = /^\[([^\]]+)\]:\s*(.+?)\s*$/;
const SECTION_RE = /^##\s+\[([^\]]+)\](?:\s*-\s*([0-9]{4}-[0-9]{2}-[0-9]{2}))?\s*$/;

export function parse(text: string): Changelog {
  const eol: '\n' | '\r\n' = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);

  // A trailing newline produces an empty final element from split — drop it once.
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  const { mainLines, links } = extractTrailingLinkRefs(lines);
  const { header, sections } = splitHeaderAndSections(mainLines);

  let unreleased: Section | null = null;
  const releases: Section[] = [];
  for (const section of sections) {
    if (section.version.toLowerCase() === 'unreleased') {
      unreleased = { ...section, version: 'Unreleased' };
    } else {
      releases.push(section);
    }
  }

  return { header, unreleased, releases, links, eol };
}

function extractTrailingLinkRefs(lines: string[]): { mainLines: string[]; links: LinkRef[] } {
  // Walk from the end, accepting link-refs and blank lines until the first non-link, non-blank.
  let cut = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (line === '' || LINK_REF_RE.test(line)) {
      cut = i;
    } else {
      break;
    }
  }

  const links: LinkRef[] = [];
  for (let i = cut; i < lines.length; i++) {
    const m = LINK_REF_RE.exec(lines[i]!);
    if (m) links.push({ name: m[1]!, url: m[2]! });
  }

  return { mainLines: lines.slice(0, cut), links };
}

function splitHeaderAndSections(mainLines: string[]): {
  header: string[];
  sections: Section[];
} {
  const header: string[] = [];
  const sections: Section[] = [];

  let i = 0;
  while (i < mainLines.length && !SECTION_RE.test(mainLines[i]!)) {
    header.push(mainLines[i]!);
    i++;
  }
  trimTrailingBlanks(header);

  while (i < mainLines.length) {
    const m = SECTION_RE.exec(mainLines[i]!);
    if (!m) {
      // Should not happen if the file is well-formed; skip stray content between sections.
      i++;
      continue;
    }
    const version = m[1]!;
    const date = m[2] ?? null;
    i++;

    const body: string[] = [];
    while (i < mainLines.length && !SECTION_RE.test(mainLines[i]!)) {
      body.push(mainLines[i]!);
      i++;
    }
    trimLeadingBlanks(body);
    trimTrailingBlanks(body);

    sections.push({ version, date, body });
  }

  return { header, sections };
}

function trimTrailingBlanks(lines: string[]): void {
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
}

function trimLeadingBlanks(lines: string[]): void {
  while (lines.length > 0 && lines[0] === '') lines.shift();
}

export function release(cl: Changelog, opts: ReleaseOptions): Changelog {
  if (!cl.unreleased) {
    throw new PubvError(
      'no-unreleased',
      'CHANGELOG.md has no [Unreleased] section — nothing to graduate.',
    );
  }

  const newRelease: Section = {
    version: opts.version,
    date: opts.date,
    body: [...cl.unreleased.body],
  };
  const newUnreleased: Section = { version: 'Unreleased', date: null, body: [] };

  const links = rewriteLinks(cl.links, opts);

  return {
    header: cl.header,
    unreleased: newUnreleased,
    releases: [newRelease, ...cl.releases],
    links,
    eol: cl.eol,
  };
}

function rewriteLinks(existing: LinkRef[], opts: ReleaseOptions): LinkRef[] {
  const out: LinkRef[] = [];
  let inserted = false;

  for (const link of existing) {
    if (link.name.toLowerCase() === 'unreleased') {
      out.push({ name: 'Unreleased', url: opts.unreleasedUrl });
      out.push({ name: opts.version, url: opts.versionUrl });
      inserted = true;
    } else {
      out.push(link);
    }
  }

  if (!inserted) {
    out.unshift(
      { name: 'Unreleased', url: opts.unreleasedUrl },
      { name: opts.version, url: opts.versionUrl },
    );
  }

  return out;
}

export function serialize(cl: Changelog): string {
  const out: string[] = [];

  for (const line of cl.header) out.push(line);

  if (cl.header.length > 0 && (cl.unreleased || cl.releases.length > 0)) {
    out.push('');
  }

  if (cl.unreleased) appendSection(out, cl.unreleased);
  for (const r of cl.releases) appendSection(out, r);

  if (cl.links.length > 0) {
    if (out.length > 0 && out[out.length - 1] !== '') out.push('');
    for (const link of cl.links) out.push(`[${link.name}]: ${link.url}`);
  }

  const collapsed = collapseBlankRuns(out);
  trimTrailingBlanks(collapsed);
  return collapsed.join(cl.eol) + cl.eol;
}

function appendSection(out: string[], section: Section): void {
  if (out.length > 0 && out[out.length - 1] !== '') out.push('');
  out.push(formatHeading(section));
  if (section.body.length > 0) {
    out.push('');
    for (const line of section.body) out.push(line);
  }
}

function formatHeading(section: Section): string {
  return section.date ? `## [${section.version}] - ${section.date}` : `## [${section.version}]`;
}

function collapseBlankRuns(lines: string[]): string[] {
  const out: string[] = [];
  let lastBlank = false;
  for (const line of lines) {
    const blank = line === '';
    if (blank && lastBlank) continue;
    out.push(line);
    lastBlank = blank;
  }
  return out;
}

/**
 * Return the most recent versioned release, or `null` if the file has none.
 * Useful for picking the baseline version for the next bump.
 */
export function latestRelease(cl: Changelog): Section | null {
  return cl.releases[0] ?? null;
}
