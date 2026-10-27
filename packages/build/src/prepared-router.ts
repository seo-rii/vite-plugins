import type { Plugin } from 'vite'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export type PreparedRouterOptions = {
  /** All paths registered by the application, its sub-apps, and entry hooks. */
  paths: string[]
}

type RouterModule = {
  PreparedRegExpRouter?: unknown
  buildInitParams?: (options: { paths: string[] }) => unknown
  serializeInitParams?: (params: unknown) => string
}

type LoadHook = Exclude<NonNullable<Plugin['load']>, { handler: unknown }>

export const createPreparedRouter = (options?: PreparedRouterOptions): { load: LoadHook } => ({
  async load(id) {
    if (!options || !/\/reg-exp-router\/index\.js$/.test(id)) {
      return
    }

    const moduleUrl = pathToFileURL(id)
    // Resolving the module currently being loaded can deadlock Vite's CJS plugin.
    const packageJson = new URL('../../../package.json', moduleUrl)
    let packageName: string | undefined
    try {
      packageName = (JSON.parse(await readFile(packageJson, 'utf8')) as { name?: string }).name
    } catch {
      return
    }
    if (packageName !== 'hono') {
      return
    }

    // Compile with the same Hono installation that supplies the runtime router.
    const router = (await import(moduleUrl.href)) as RouterModule
    if (
      typeof router.PreparedRegExpRouter !== 'function' ||
      typeof router.buildInitParams !== 'function' ||
      typeof router.serializeInitParams !== 'function'
    ) {
      this.error(
        'The preparedRouter option requires Hono >= 4.9.11. Upgrade Hono in the application or remove preparedRouter.'
      )
    }

    let serialized: string
    try {
      // The generated entry and global middleware also need to match unknown paths.
      const paths = [...new Set(['*', ...options.paths])]
      serialized = router.serializeInitParams(router.buildInitParams({ paths }))
    } catch (error) {
      this.error(`Cannot compile preparedRouter.paths: ${String(error)}`)
    }

    // Keep the original exports available without intercepting this module again.
    const original = JSON.stringify(`${id}?hono-vite-build-original`)
    return `export * from ${original}
import { PreparedRegExpRouter } from ${original}
export class RegExpRouter extends PreparedRegExpRouter {
  constructor() {
    // Each router needs its own mutable matcher and handler tables.
    super(...${serialized})
  }
}`
  },
})
