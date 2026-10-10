/**
 * Shared test harness: load the built browser bundle the way the shell does.
 *
 * `lib/client.js` is a module-loader closure that calls
 * `window.__ModuleLoader__.load({ id, factory })` and resolves its bare imports
 * through the injected `require`. This harness supplies both plus the DOM
 * surface the module touches, so tests run against the exact bytes the GUI
 * fetches rather than against a re-implementation.
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

/** `require` rooted at this file, for the CommonJS-only test dependencies. */
export { require }

/** Repository root, derived from this file's location. */
export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** Build the instant of one Beijing wall-clock moment. */
export const bj = (text) => new Date(`${text}+08:00`)

/**
 * Instantiate the built client bundle with the loader contract the shell uses.
 * @returns the factory's exports.
 */
export async function loadClientBundle() {
  const source = await readFile(join(ROOT, 'lib', 'client.js'), 'utf8')
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  let factory
  // The bundle registers itself at load time exactly as it does in the browser.
  globalThis.window = {
    __ModuleLoader__: { load: (registration) => { factory = registration.factory } },
  }
  globalThis.document = { createElement: () => ({ dataset: {}, textContent: '', remove() {} }), head: { appendChild() {} } }
  try {
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', source)(globalThis.window, globalThis.document)
  } finally {
    globalThis.window = previousWindow
    globalThis.document = previousDocument
  }
  assert.ok(factory, 'the bundle must register a factory with __ModuleLoader__')
  // React arrives through the loader's require, as it does in the shell.
  return factory((specifier) => require(specifier))
}
