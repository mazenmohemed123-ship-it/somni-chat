import { defineConfig } from 'tsup';
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  external: ['react', 'react-dom', '@somni/chat-react', '@somni/chat-core'],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
