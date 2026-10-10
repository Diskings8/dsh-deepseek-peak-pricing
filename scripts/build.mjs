/**
 * Build script for dsh-deepseek-peak-pricing.
 *
 * Three artifacts, all consumed straight off disk by DeepSeek Harness:
 *
 * - `lib/shared/pricing.js` — ESM, the pure rule core. `tests/pricing.test.mjs`
 *   imports this exact file, so the tests exercise the shipped bytes.
 * - `lib/index.js` — ESM, the Node half, bundled into one file. The Loader
 *   imports it as a Cordis function plugin, so its named exports (`name`,
 *   `inject`, `Config`, `apply`) must survive the bundle; `@deepseek-ai/*`
 *   stays external and resolves from the profile install.
 * - `lib/client.js` — the browser half, wrapped in the shell's module-loader
 *   closure so it is fetched and instantiated like any shipped UI plugin. Its
 *   only bare imports (`react`, `react/jsx-runtime`,
 *   `@deepseek-ai/dsh-client-ui-slots`) are shell platform modules answered
 *   from the loader's injected `require`; the rule core is inlined.
 *
 * Run: `node scripts/build.mjs`
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build as esbuild } from 'esbuild'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SRC = join(ROOT, 'src')
const LIB = join(ROOT, 'lib')

/** The plugin id stamped into the loader handoff and the injected style tag. */
const PLUGIN_ID = 'dsh-deepseek-peak-pricing'

/**
 * Specifiers the shell's module table answers for a dynamically fetched client
 * bundle. Anything else the browser half imports must inline, so this list is
 * also the build-time purity gate.
 */
const PLATFORM_MODULES = ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-slots']

/** Render a path relative to the repository root with forward slashes. */
function rel(path) {
  return relative(ROOT, path).split('\\').join('/')
}

/**
 * Run one esbuild pass that bundles a source entry.
 * @param options - entry point, module format, and which bare specifiers stay external.
 * @returns the bundled code plus a sourcemap comment.
 */
async function bundle({ entry, format, external, platform, outfile }) {
  const result = await esbuild({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format,
    platform,
    target: 'es2022',
    jsx: 'automatic',
    sourcemap: 'external',
    sourceRoot: '../',
    external,
    logLevel: 'warning',
    banner: { js: `// ${rel(entry)} → ${rel(outfile)}` },
  })
  if (result.errors.length > 0) throw new Error(`esbuild failed for ${rel(entry)}`)
  return `${await readFile(outfile, 'utf8')}\n//# sourceMappingURL=${rel(outfile).split('/').pop()}.map\n`
}

/**
 * Wrap the browser half in the module-loader closure the shell expects: a
 * CommonJS shim, the factory, and the handoff registration.
 * @param body - the browser bundle body, already bound to `require`.
 * @returns the complete `lib/client.js`.
 */
function wrapClient(body) {
  return [
    `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    'var module = { exports: {} }; var exports = module.exports;',
    body,
    'return module.exports; } });',
    '',
  ].join('\n')
}

/** Build every artifact and report what landed on disk. */
async function build() {
  await rm(LIB, { recursive: true, force: true })
  await mkdir(join(LIB, 'shared'), { recursive: true })

  // The rule core keeps its own identity: the test suite imports it directly.
  const sharedOut = join(LIB, 'shared', 'pricing.js')
  await bundle({ entry: join(SRC, 'shared', 'pricing.ts'), format: 'esm', external: [], platform: 'neutral', outfile: sharedOut })

  // The Node half bundles to one file so the Loader sees a single module with
  // the plugin metadata as named exports.
  const hostOut = join(LIB, 'index.js')
  await bundle({
    entry: join(SRC, 'host', 'index.ts'),
    format: 'esm',
    external: ['@deepseek-ai/cordis', '@deepseek-ai/schemastery', '@deepseek-ai/dsh-tools'],
    platform: 'node',
    outfile: hostOut,
  })

  // The browser half: everything but the platform modules inlined, then wrapped.
  const clientOut = join(LIB, 'client.js')
  const clientBody = await bundle({
    entry: join(SRC, 'client', 'index.tsx'),
    format: 'cjs',
    external: PLATFORM_MODULES,
    platform: 'browser',
    outfile: clientOut,
  })
  await writeFile(clientOut, wrapClient(clientBody.replace(/^\/\/# sourceMappingURL=.*$/m, '').trimEnd()))
  await writeFile(`${clientOut}.map`, await readFile(`${clientOut}.map`, 'utf8'))

  const artifacts = [hostOut, clientOut, sharedOut]
  const report = []
  for (const file of artifacts) {
    report.push(`${rel(file)} ${(await readFile(file, 'utf8')).length} B`)
  }
  process.stdout.write(`built ${PLUGIN_ID}\n  ${report.join('\n  ')}\n`)
}

await build()
