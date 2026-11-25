import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    modulePreload: false,
    // Measured (rollup renderedLength, Nov 2026): the only chunks over 500 kB
    // are the lazily-loaded 3D Edit controller (~1.15 MB, hundreds of small
    // topology-edit modules with no large leaf) and three.js itself. Splitting
    // the 3D Edit graph would not speed up opening 3D Edit and risks the
    // chunk-evaluation-order (TDZ) boot failures documented upstream, so the
    // warning threshold sits just above it instead.
    chunkSizeWarningLimit: 1200,
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
