import path from 'node:path';
import type { LicenseInfo } from '../types.js';
import { findCaseInsensitive, readTextSafe } from '../utils/fs.js';

const LICENSE_FILENAMES = [
  'LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'LICENCE.txt',
  'COPYING', 'COPYING.md', 'UNLICENSE',
];

interface LicenseRule {
  spdx: string;
  family: string;
  all: RegExp[];
  none?: RegExp[];
}

const RULES: LicenseRule[] = [
  { spdx: 'MIT', family: 'MIT', all: [/permission is hereby granted, free of charge/i, /the software is provided "as is"/i] },
  { spdx: 'Apache-2.0', family: 'Apache', all: [/apache license/i, /version 2\.0/i] },
  { spdx: 'GPL-3.0-only', family: 'GPL', all: [/gnu general public license/i, /version 3/i], none: [/lesser/i] },
  { spdx: 'GPL-2.0-only', family: 'GPL', all: [/gnu general public license/i, /version 2/i], none: [/lesser/i] },
  { spdx: 'LGPL-3.0-only', family: 'LGPL', all: [/gnu lesser general public license/i, /version 3/i] },
  { spdx: 'AGPL-3.0-only', family: 'AGPL', all: [/gnu affero general public license/i] },
  { spdx: 'MPL-2.0', family: 'Mozilla', all: [/mozilla public license/i, /version 2\.0/i] },
  { spdx: 'BSD-3-Clause', family: 'BSD', all: [/redistribution and use in source and binary forms/i, /neither the name of/i] },
  { spdx: 'BSD-2-Clause', family: 'BSD', all: [/redistribution and use in source and binary forms/i], none: [/neither the name of/i] },
  { spdx: 'Unlicense', family: 'Unlicense', all: [/this is free and unencumbered software/i] },
  { spdx: '0BSD', family: 'BSD', all: [/permission to use, copy, modify/i] },
  { spdx: 'ISC', family: 'ISC', all: [/isc license|permission to use, copy, modify, and\/or distribute/i] },
  { spdx: 'CC0-1.0', family: 'CC0', all: [/creative commons/i, /cc0/i] },
];

export function detectLicense(root: string, spdxHint?: string): LicenseInfo | null {
  const filename = LICENSE_FILENAMES.map((f) => findCaseInsensitive(root, f)).find(Boolean);
  if (filename) {
    const text = readTextSafe(path.join(root, filename));
    if (text) {
      const head = text.slice(0, 8000);
      for (const rule of RULES) {
        if (rule.all.every((re) => re.test(head)) && !(rule.none ?? []).some((re) => re.test(head))) {
          return { spdx: rule.spdx, family: rule.family, file: filename };
        }
      }
      return { family: 'Custom', file: filename };
    }
  }
  if (spdxHint && spdxHint !== 'UNLICENSED' && spdxHint !== 'SEE LICENSE IN LICENSE') {
    return { spdx: spdxHint, family: familyOf(spdxHint) };
  }
  return null;
}

function familyOf(spdx: string): string {
  const base = spdx.split('-')[0]!;
  return /MIT|Apache|GPL|BSD|ISC|MPL|CC0|Unlicense|AGPL|LGPL/i.test(base) ? base : 'Custom';
}

/** Does README prose appear to name the detected licence? */
export function licenseMentionedIn(text: string, license: LicenseInfo | null): boolean {
  if (!license) return false;
  if (license.spdx && new RegExp(escapeRe(license.spdx), 'i').test(text)) return true;
  return new RegExp(`\\b${escapeRe(license.family)}\\b`, 'i').test(text);
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
