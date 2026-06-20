// ESM resolve hook: lets test files import TypeScript sources using the same
// extensionless specifiers the package uses internally (e.g. './engine/ChatEngine').
// Used together with Node's `--experimental-strip-types`.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
  if (isRelative && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    const base = new URL(specifier, context.parentURL);
    const candidates = [base.href + '.ts', base.href + '.tsx', base.href + '/index.ts'];
    for (const c of candidates) {
      if (existsSync(fileURLToPath(c))) return { url: c, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
