// The copies of pox-smart-contract-litvm's spec/ the suite holds in
// test/fixtures/, taken at SOURCE_COMMIT (spec/README.md "Pinning a copy"),
// and the checkout their source-commit tests read that commit from with `git
// show`: the directory POX_SMART_CONTRACT_LITVM names, else the first
// pox-smart-contract-litvm beside this repository or beside any directory
// above it. A checkout's working tree is never read. npm test runs
// test/**/*.test.js, so this module registers no test.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SPEC = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const REPO = path.resolve(SPEC, '..', '..');
export const SOURCE_COMMIT = '2f600f6';
export const SOURCE_ENV = 'POX_SMART_CONTRACT_LITVM';
export const MANIFEST = 'MANIFEST.sha256';
export const COPIES = ['abi-selectors.json', 'capability-record.json', 'matching-rank.json', 'matching.md', 'ranking.json',
  'reserved-prefixes.json', 'result-fields.json', 'result-v5.json', 'runner-terms.json', 'session-rows.json'];

// The parsed JSON copy `name`.
export const load = (name) => JSON.parse(readFileSync(path.join(SPEC, name), 'utf8'));

// The pox-smart-contract-litvm checkout the source-commit tests read for a
// repository at `repo`, null when there is none.
export const checkout = (repo = REPO, env = process.env) => {
  const named = env[SOURCE_ENV];
  if (named) return existsSync(path.join(named, '.git')) ? path.resolve(named) : null;
  for (let base = path.dirname(repo); ; base = path.dirname(base)) {
    const candidate = path.join(base, 'pox-smart-contract-litvm');
    if (existsSync(path.join(candidate, '.git'))) return candidate;
    if (path.dirname(base) === base) return null;
  }
};

// The bytes of `file` at `commit` in the checkout (`git show`), null when
// there is no checkout or it holds no such commit or file.
export const shownAt = (file, commit = SOURCE_COMMIT) => {
  const source = checkout();
  if (source === null) return null;
  try {
    return execFileSync('git', ['-C', source, 'show', `${commit}:${file}`], { maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    return null;
  }
};
