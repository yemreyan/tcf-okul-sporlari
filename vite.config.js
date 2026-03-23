import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import obfuscatorPlugin from 'rollup-plugin-obfuscator'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5555,
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        basvuru: resolve(__dirname, 'basvuru.html'),
      },
      output: {
        manualChunks: {
          // React core — her sayfada lazım, ayrı cache'lensin
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // Firebase — her sayfada lazım ama büyük
          'vendor-firebase': ['firebase/app', 'firebase/database'],
          // Recharts — sadece AnalyticsPage kullanıyor (~160KB)
          'vendor-recharts': ['recharts'],
          // XLSX — sadece FinalsPage ve RefereesPage kullanıyor (~165KB)
          'vendor-xlsx': ['xlsx'],
        },
      },
      plugins: [
        obfuscatorPlugin({
          include: ['**/basvuru*.js'],
          obfuscatorOptions: {
            compact: true,
            controlFlowFlattening: true,
            controlFlowFlatteningThreshold: 0.75,
            deadCodeInjection: true,
            deadCodeInjectionThreshold: 0.4,
            debugProtection: false,
            disableConsoleOutput: true,
            identifierNamesGenerator: 'hexadecimal',
            log: false,
            numbersToExpressions: true,
            renameGlobals: false,
            selfDefending: true,
            simplify: true,
            splitStrings: true,
            splitStringsChunkLength: 5,
            stringArray: true,
            stringArrayCallsTransform: true,
            stringArrayCallsTransformThreshold: 1,
            stringArrayEncoding: ['rc4'],
            stringArrayIndexShift: true,
            stringArrayRotate: true,
            stringArrayShuffle: true,
            stringArrayWrappersCount: 2,
            stringArrayWrappersChainedCalls: true,
            stringArrayWrappersParametersMaxCount: 4,
            stringArrayWrappersType: 'function',
            stringArrayThreshold: 1,
            transformObjectKeys: true,
            unicodeEscapeSequence: false,
          },
        }),
      ],
    },
  },
})
