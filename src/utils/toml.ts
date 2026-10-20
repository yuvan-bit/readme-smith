/**
 * A small, dependency-free TOML reader.
 *
 * It covers what project manifests actually use: tables, dotted keys,
 * multi-line arrays, strings (basic + literal), integers, floats, booleans and
 * inline tables. It deliberately does NOT implement every TOML edge case
 * (no array-of-tables ordering guarantees beyond append, no datetime typing).
 * Anything it cannot parse is skipped rather than thrown, because a partial
 * read of `pyproject.toml` is still far better than nothing.
 */

export type TomlValue = string | number | boolean | TomlValue[] | { [k: string]: TomlValue };

export function parseToml(text: string): Record<string, TomlValue> {
  const root: Record<string, TomlValue> = {};
  let current: Record<string, TomlValue> = root;
  let i = 0;
  const n = text.length;

  const isWs = (ch: string) => ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n';
  const skipWsAndComments = () => {
    while (i < n) {
      const ch = text[i]!;
      if (isWs(ch)) { i++; continue; }
      if (ch === '#') { while (i < n && text[i] !== '\n') i++; continue; }
      break;
    }
  };

  const parseKey = (): string[] => {
    const parts: string[] = [];
    for (;;) {
      skipWsAndComments();
      const ch = text[i];
      if (ch === '"' || ch === "'") {
        const q = ch;
        i++;
        let buf = '';
        while (i < n && text[i] !== q) {
          if (text[i] === '\\' && q === '"' && i + 1 < n) { buf += text[i + 1]; i += 2; continue; }
          buf += text[i];
          i++;
        }
        i++; // closing quote
        parts.push(buf);
      } else {
        let buf = '';
        while (i < n && /[A-Za-z0-9_-]/.test(text[i]!)) { buf += text[i]; i++; }
        if (buf) parts.push(buf);
      }
      skipWsAndComments();
      if (text[i] === '.') { i++; continue; }
      break;
    }
    return parts;
  };

  const parseValue = (): TomlValue | undefined => {
    skipWsAndComments();
    const ch = text[i];
    if (ch === undefined) return undefined;

    // Multi-line basic string """..."""
    if (text.startsWith('"""', i)) {
      i += 3;
      const end = text.indexOf('"""', i);
      const v = end === -1 ? text.slice(i) : text.slice(i, end);
      i = end === -1 ? n : end + 3;
      return v;
    }
    // Multi-line literal string '''...'''
    if (text.startsWith("'''", i)) {
      i += 3;
      const end = text.indexOf("'''", i);
      const v = end === -1 ? text.slice(i) : text.slice(i, end);
      i = end === -1 ? n : end + 3;
      return v;
    }
    if (ch === '"') {
      i++;
      let buf = '';
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < n) {
          const esc = text[i + 1]!;
          const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', b: '\b', f: '\f' };
          buf += map[esc] ?? esc;
          i += 2;
          continue;
        }
        buf += text[i];
        i++;
      }
      i++;
      return buf;
    }
    if (ch === "'") {
      i++;
      const end = text.indexOf("'", i);
      const v = end === -1 ? text.slice(i) : text.slice(i, end);
      i = end === -1 ? n : end + 1;
      return v;
    }
    if (ch === '[') {
      i++;
      const arr: TomlValue[] = [];
      for (;;) {
        skipWsAndComments();
        if (text[i] === ']') { i++; break; }
        if (i >= n) break;
        if (text[i] === ',') { i++; continue; }
        const v = parseValue();
        if (v === undefined) { i++; continue; }
        arr.push(v);
      }
      return arr;
    }
    if (ch === '{') {
      i++;
      const obj: Record<string, TomlValue> = {};
      for (;;) {
        skipWsAndComments();
        if (text[i] === '}') { i++; break; }
        if (i >= n) break;
        if (text[i] === ',') { i++; continue; }
        const keyParts = parseKey();
        skipWsAndComments();
        if (text[i] === '=') i++;
        const v = parseValue();
        if (v !== undefined && keyParts.length) setDeep(obj, keyParts, v);
        skipWsAndComments();
        if (text[i] === ',') i++;
        else if (text[i] === '}') { i++; break; }
      }
      return obj;
    }

    // Bare token: number / bool / datetime / inf / nan
    let buf = '';
    while (i < n && !',]}#\n'.includes(text[i]!)) { buf += text[i]; i++; }
    buf = buf.trim();
    if (buf === 'true') return true;
    if (buf === 'false') return false;
    if (buf === 'inf' || buf === '+inf') return Infinity;
    if (buf === '-inf') return -Infinity;
    if (buf === 'nan') return NaN;
    const cleaned = buf.replace(/_/g, '');
    if (/^[+-]?(\d+\.?\d*([eE][+-]?\d+)?|0x[0-9a-fA-F]+|0o[0-7]+|0b[01]+)$/.test(cleaned)) {
      const num = cleaned.startsWith('0x') || cleaned.startsWith('0o') || cleaned.startsWith('0b')
        ? Number(cleaned)
        : Number(cleaned);
      if (!Number.isNaN(num)) return num;
    }
    return buf; // fall back to the raw string (covers datetimes, version specs)
  };

  const setDeep = (target: Record<string, TomlValue>, keys: string[], value: TomlValue) => {
    let node = target;
    for (let k = 0; k < keys.length - 1; k++) {
      const key = keys[k]!;
      const existing = node[key];
      if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
        node = existing as Record<string, TomlValue>;
      } else {
        const created: Record<string, TomlValue> = {};
        node[key] = created;
        node = created;
      }
    }
    node[keys[keys.length - 1]!] = value;
  };

  const ensureTable = (keys: string[]): Record<string, TomlValue> => {
    let node = root;
    for (const key of keys) {
      const existing = node[key];
      if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
        node = existing as Record<string, TomlValue>;
      } else {
        const created: Record<string, TomlValue> = {};
        node[key] = created;
        node = created;
      }
    }
    return node;
  };

  while (i < n) {
    skipWsAndComments();
    if (i >= n) break;

    if (text[i] === '[') {
      const isArrayOfTables = text.startsWith('[[', i);
      i += isArrayOfTables ? 2 : 1;
      const keys = parseKey();
      while (i < n && text[i] !== ']') i++;
      i += isArrayOfTables ? 2 : 1;

      if (isArrayOfTables) {
        let node = root;
        for (let k = 0; k < keys.length - 1; k++) node = ensureTable(keys.slice(0, k + 1)) as Record<string, TomlValue>;
        const lastKey = keys[keys.length - 1]!;
        const parent = keys.length > 1 ? ensureTable(keys.slice(0, -1)) : root;
        const existing = parent[lastKey];
        const created: Record<string, TomlValue> = {};
        if (Array.isArray(existing)) existing.push(created);
        else parent[lastKey] = [created];
        node = created;
        current = node;
      } else {
        current = ensureTable(keys);
      }
      continue;
    }

    const keys = parseKey();
    skipWsAndComments();
    if (text[i] === '=') i++;
    else { // malformed line — skip to end of line
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    const value = parseValue();
    if (value !== undefined && keys.length) setDeep(current, keys, value);
    while (i < n && text[i] !== '\n') i++;
  }

  return root;
}

/** Safe dotted-path lookup: `get(toml, 'project', 'name')`. */
export function getToml(obj: unknown, ...keys: string[]): unknown {
  let node: unknown = obj;
  for (const key of keys) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

export function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

export function asRecord(v: unknown): Record<string, TomlValue> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, TomlValue>) : undefined;
}
