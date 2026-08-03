/**
 * Module resolution hooks so plain `node` can import the project's TypeScript
 * directly, without adding a test runner or bundler to the toolchain.
 *
 * Node 22.18+/24 strips TypeScript types natively, but it still resolves
 * specifiers the way ESM does — so two things the codebase relies on need
 * bridging:
 *
 *   - extensionless relative imports (`./dates`), which TypeScript allows and
 *     Node does not
 *   - the `@/*` path alias from tsconfig.json
 *
 * Registered via node:module's `register()` — see scripts/test-intake-report.mjs.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve as resolvePath } from 'node:path';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

const EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs'];

/** Appends the first extension that names a real file, if any. */
function withExtension(basePath) {
  for (const ext of EXTENSIONS) {
    if (existsSync(basePath + ext)) return basePath + ext;
  }
  if (existsSync(basePath)) return basePath;
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  // `@/lib/foo` → <root>/lib/foo.ts
  if (specifier.startsWith('@/')) {
    const resolved = withExtension(join(ROOT, specifier.slice(2)));
    if (resolved) {
      return { url: pathToFileURL(resolved).href, shortCircuit: true };
    }
  }

  // `./dates` → ./dates.ts, but leave `./data.json` and friends alone.
  if (specifier.startsWith('.') && !/\.[a-z0-9]+$/i.test(specifier)) {
    const parentPath = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : ROOT;
    const resolved = withExtension(resolvePath(parentPath, specifier));
    if (resolved) {
      return { url: pathToFileURL(resolved).href, shortCircuit: true };
    }
  }

  return nextResolve(specifier, context);
}
