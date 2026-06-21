import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'providers/livekit': 'src/provider/livekitEntry.ts',
    'providers/daily': 'src/provider/DailyCallProvider.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: true,
  treeshake: true,
  sourcemap: true,
  clean: true,
  external: ['livekit-client', '@daily-co/daily-js'],
});
