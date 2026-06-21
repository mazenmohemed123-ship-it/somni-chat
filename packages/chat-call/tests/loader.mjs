// ESM resolve hook: lets test files import TypeScript sources using extensionless
// specifiers (matching how the package imports internally). Pairs with Node's
// `--experimental-strip-types`.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  // Map the workspace dependency to its TypeScript source (no node_modules needed).
  if (specifier === '@somni/chat-core') {
    return { url: new URL('../../chat-core/src/index.ts', import.meta.url).href, shortCircuit: true };
  }

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
