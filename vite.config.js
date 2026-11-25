import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    modulePreload: false,
    rollupOptions: {
      output: {
        // Dependency-only partition; workspace modules stay graph-owned so
        // Rollup controls evaluation order of the stateful controllers.
        manualChunks(id) {
          const source = id.replaceAll('\\', '/');
          if (source.includes('/node_modules/three/')) return 'vendor-three';
          if (source.includes('/node_modules/xlsx/')) return undefined;
          if (source.includes('/node_modules/')) return 'vendor';
          return undefined;
        },
      },
    },
  },
});
