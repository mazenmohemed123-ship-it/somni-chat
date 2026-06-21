import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
  if (isRelative) {
    const base = new URL(specifier, context.parentURL);
    const path = fileURLToPath(base.href);

    // remap .js → .ts if .ts exists (for source imports using ESM .js extensions)
    if (path.endsWith('.js')) {
      const tsPath = path.slice(0, -3) + '.ts';
      if (existsSync(tsPath)) return { url: base.href.slice(0, -3) + '.ts', shortCircuit: true };
    }

    // add extension for extensionless imports
    if (!/\.[cm]?[jt]sx?$/.test(specifier)) {
      const candidates = [base.href + '.ts', base.href + '.tsx', base.href + '/index.ts'];
      for (const c of candidates) {
        if (existsSync(fileURLToPath(c))) return { url: c, shortCircuit: true };
      }
    }
  }
  return nextResolve(specifier, context);
}
