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
  /**
   * Non-fatal repairs applied while parsing / transforming — e.g. stray lines
   * dropped from the link-reference region, or duplicate link defs collapsed.
   * Surfaced to the user so a silently-normalized changelog is never a surprise.
   */
  warnings: string[];
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
const SECTION_START_RE = /^##\s+\[([^\]]+)\]/;
// The heading text may carry a markdown link target — reference-style
// `## [Unreleased][unreleased]` or inline `## [Unreleased](unreleased)`. It is
// discarded here; link refs are regenerated on release.
const LINK_TARGET_RE = /^\[[^\]]*\]|^\([^)]*\)/;
const SECTION_DATE_RE = /^\s*-\s*(\d{4}-\d{2}-\d{2})\s*$/;

interface SectionMatch {
  name: string;
  date: string | null;
}

function matchSection(line: string): SectionMatch | null {
  const start = SECTION_START_RE.exec(line);
  if (!start) {
    return null;
  }
  let rest = line.slice(start[0].length);
  const target = LINK_TARGET_RE.exec(rest);
  if (target) {
    rest = rest.slice(target[0].length);
  }
  if (rest.trim() === '') {
    return { name: start[1]!, date: null };
  }
  const date = SECTION_DATE_RE.exec(rest);
  return date ? { name: start[1]!, date: date[1]! } : null;
}

function isSectionHeading(line: string): boolean {
  return matchSection(line) !== null;
}

export function parse(text: string): Changelog {
  const eol: '\n' | '\r\n' = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);

  // A trailing newline produces an empty final element from split — drop it once.
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  const { mainLines, links: rawLinks, dropped } = extractTrailingLinkRefs(lines);
  const { header, sections } = splitHeaderAndSections(mainLines);
  const { links, collapsed } = dedupeLinks(rawLinks);

  let unreleased: Section | null = null;
  const releases: Section[] = [];
  for (const section of sections) {
    if (section.version.toLowerCase() === 'unreleased') {
      unreleased = { ...section, version: 'Unreleased' };
    } else {
      releases.push(section);
    }
  }

  const warnings: string[] = [];
  if (dropped.length > 0) warnings.push(droppedWarning(dropped));
  for (const name of collapsed) warnings.push(collapsedWarning(name));

  return { header, unreleased, releases, links, eol, warnings };
}

/**
 * Extract the trailing block of `[name]: url` link-reference definitions.
 *
 * Link refs always sit at the very tail of a Keep a Changelog file, after the
 * final section. We locate that block from the bottom up rather than trusting
 * the last line to be well-formed: a single stray line (e.g. a fat-fingered
 * `˚`) below the refs must not hide them — otherwise the refs get absorbed into
 * a section body and duplicated on the next release. Scoped to the tail so a
 * `[x]: y`-shaped line inside a section body is never yanked out mid-document.
 */
function extractTrailingLinkRefs(lines: string[]): {
  mainLines: string[];
  links: LinkRef[];
  dropped: string[];
} {
  // Find the last link-ref, scanning up from EOF but never crossing a section
  // heading — refs live after the final section, so a heading means there are
  // none trailing (leave the file untouched: no links, nothing dropped).
  let lastLink = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (LINK_REF_RE.test(lines[i]!)) {
      lastLink = i;
      break;
    }
    if (isSectionHeading(lines[i]!)) break;
  }
  if (lastLink === -1) return { mainLines: lines, links: [], dropped: [] };

  // Walk further up across contiguous link-refs and blank lines to the block top.
  let top = lastLink;
  for (let i = lastLink - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (line === '' || LINK_REF_RE.test(line)) top = i;
    else break;
  }

  // Everything from the block top to EOF is the link region: refs become links,
  // non-blank non-link lines (junk trailing the refs) are dropped.
  const links: LinkRef[] = [];
  const dropped: string[] = [];
  for (let i = top; i < lines.length; i++) {
    const line = lines[i]!;
    const m = LINK_REF_RE.exec(line);
    if (m) links.push({ name: m[1]!, url: m[2]! });
    else if (line !== '') dropped.push(line);
  }

  return { mainLines: lines.slice(0, top), links, dropped };
}

/**
 * Collapse duplicate link definitions, keeping the first occurrence of each name
 * (`Unreleased` matched case-insensitively). Returns the deduped list and the
 * names that were collapsed, so callers can report the repair.
 */
function dedupeLinks(links: LinkRef[]): { links: LinkRef[]; collapsed: string[] } {
  const seen = new Set<string>();
  const out: LinkRef[] = [];
  const collapsed: string[] = [];
  for (const link of links) {
    const key = link.name.toLowerCase();
    if (seen.has(key)) {
      collapsed.push(link.name);
      continue;
    }
    seen.add(key);
    out.push(link);
  }
  return { links: out, collapsed };
}

function droppedWarning(dropped: string[]): string {
  const list = dropped.map((line) => `"${line}"`).join(', ');
  const plural = dropped.length === 1 ? 'line' : 'lines';
  return `ignored ${dropped.length} stray ${plural} below the link-reference section: ${list}`;
}

function collapsedWarning(name: string): string {
  return `collapsed duplicate link definition [${name}]`;
}

function splitHeaderAndSections(mainLines: string[]): {
  header: string[];
  sections: Section[];
} {
  const header: string[] = [];
  const sections: Section[] = [];

  let i = 0;
  while (i < mainLines.length && !isSectionHeading(mainLines[i]!)) {
    header.push(mainLines[i]!);
    i++;
  }
  trimTrailingBlanks(header);

  while (i < mainLines.length) {
    const m = matchSection(mainLines[i]!);
    if (!m) {
      // Should not happen if the file is well-formed; skip stray content between sections.
      i++;
      continue;
    }
    const version = m.name;
    const date = m.date;
    i++;

    const body: string[] = [];
    while (i < mainLines.length && !isSectionHeading(mainLines[i]!)) {
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

  const { links, collapsed } = rewriteLinks(cl.links, opts);
  const warnings = [...cl.warnings, ...collapsed.map(collapsedWarning)];

  return {
    header: cl.header,
    unreleased: newUnreleased,
    releases: [newRelease, ...cl.releases],
    links,
    eol: cl.eol,
    warnings,
  };
}

function rewriteLinks(
  existing: LinkRef[],
  opts: ReleaseOptions,
): { links: LinkRef[]; collapsed: string[] } {
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

  // Inserting the new `[version]` def can collide with a stale one already in
  // the source (as when a first release reuses a hand-written link ref); drop
  // the duplicate so the output never carries two defs for the same name.
  return dedupeLinks(out);
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
