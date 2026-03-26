import { defineConfig } from 'vite'
import { resolve } from 'path'
import obfuscatorPlugin from 'rollup-plugin-obfuscator'

// Sadece başvuru sayfası — yemreyan.xyz/okulspor/ için ayrı build
export default defineConfig({
  base: '/okulspor/',
  build: {
    outDir: 'dist-okulspor',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'basvuru.html'),
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
