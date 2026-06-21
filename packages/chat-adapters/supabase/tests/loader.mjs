import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CORE_SRC = new URL('../../../chat-core/src/index.ts', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  // Map the published package name to local source for tests.
  if (specifier === '@somni/chat-core') {
    return { url: CORE_SRC, shortCircuit: true };
  }

  const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
  if (isRelative) {
    const base = new URL(specifier, context.parentURL);
    const path = fileURLToPath(base.href);
    if (path.endsWith('.js')) {
      const tsPath = path.slice(0, -3) + '.ts';
      if (existsSync(tsPath)) return { url: base.href.slice(0, -3) + '.ts', shortCircuit: true };
    }
    if (!/\.[cm]?[jt]sx?$/.test(specifier)) {
      const candidates = [base.href + '.ts', base.href + '.tsx', base.href + '/index.ts'];
      for (const c of candidates) {
        if (existsSync(fileURLToPath(c))) return { url: c, shortCircuit: true };
      }
    }
  }
  return nextResolve(specifier, context);
}
