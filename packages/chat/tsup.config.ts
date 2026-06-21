import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    react: 'src/react.ts',
    call: 'src/call.ts',
    'adapters/supabase': 'src/adapters/supabase.ts',
    'adapters/appwrite': 'src/adapters/appwrite.ts',
    'adapters/firebase': 'src/adapters/firebase.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: true,
  treeshake: true,
  sourcemap: true,
  clean: true,
  external: [
    'react',
    'react-dom',
    '@supabase/supabase-js',
    'appwrite',
    'firebase',
    'firebase/firestore',
    'firebase/storage',
    'livekit-client',
    '@daily-co/daily-js',
  ],
});
