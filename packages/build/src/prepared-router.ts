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
}

type LoadHook = Exclude<NonNullable<Plugin['load']>, { handler: unknown }>

const canPrecompilePaths = (paths: string[]): boolean => {
  const dynamicPaths: { prefix: string; wildcard: boolean }[] = []
  for (const path of paths) {
    if (path === '*' || path === '/*') {
      continue
    }
    if (!path.startsWith('/')) {
      return false
    }
    const segments = path.slice(1).split('/')
    let firstDynamic = -1
    let wildcard = false
    for (const [index, segment] of segments.entries()) {
      // Certify literal URI segments rather than inheriting the compiler's
      // regexp syntax or internal #/@ marker handling from arbitrary text.
      if (/^[a-zA-Z0-9._~!$&'()+,;=%-]*$/.test(segment)) {
        continue
      }
      firstDynamic = firstDynamic === -1 ? index : firstDynamic
      const last = index === segments.length - 1
      if (segment === '*' && last) {
        wildcard = true
      } else if (
        !/^:[a-zA-Z_][a-zA-Z0-9_]*\??$/.test(segment) ||
        (segment.endsWith('?') && !last)
      ) {
        // Custom patterns and interior wildcards can change capture groups or
        // shadow a different method's route when compiled into a shared table.
        return false
      }
    }
    if (firstDynamic !== -1) {
      dynamicPaths.push({ prefix: segments.slice(0, firstDynamic).join('/'), wildcard })
    }
  }

  // Without method information, overlapping dynamic paths must keep separate
  // runtime tables if either path can also match a longer or shorter path.
  return !dynamicPaths.some(
    (path, index) =>
      path.wildcard &&
      dynamicPaths.some(
        (other, otherIndex) =>
          index !== otherIndex &&
          (path.prefix.startsWith(other.prefix) || other.prefix.startsWith(path.prefix))
      )
  )
}

const serializeParams = (value: unknown): string => {
  if (value instanceof RegExp) {
    return value.toString()
  }
  if (Array.isArray(value)) {
    return `[${Array.from(value, serializeParams).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const properties = Object.entries(value).map(([key, entry]) => {
      // An own __proto__ key needs computed syntax to remain a data property.
      const name = key === '__proto__' ? `[${JSON.stringify(key)}]` : JSON.stringify(key)
      return `${name}:${serializeParams(entry)}`
    })
    if (Object.getPrototypeOf(value) === null) {
      properties.unshift('__proto__:null')
    }
    return `{${properties.join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

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
      typeof router.buildInitParams !== 'function'
    ) {
      this.error(
        'The preparedRouter option requires Hono >= 4.9.11. Upgrade Hono in the application or remove preparedRouter.'
      )
    }

    const unsupportedWildcard = options.paths.find(
      (path) => path !== '*' && path.endsWith('*') && !path.endsWith('/*')
    )
    if (unsupportedWildcard !== undefined) {
      this.error(
        `preparedRouter.paths contains unsupported non-segment wildcard ${JSON.stringify(unsupportedWildcard)}. Disable preparedRouter for this application to preserve handler matching.`
      )
    }

    const paths = [...new Set(['*', ...options.paths])]
    if (!canPrecompilePaths(paths)) {
      this.warn(
        'Cannot safely precompile preparedRouter.paths with overlapping dynamic wildcards or complex path syntax. Using the original RegExpRouter to preserve method-specific matching and parameters.'
      )
      return
    }

    let serialized: string
    try {
      // The generated entry and global middleware also need to match unknown paths.
      serialized = serializeParams(router.buildInitParams({ paths }))
    } catch (error) {
      this.error(`Cannot compile preparedRouter.paths: ${String(error)}`)
    }

    // Keep the original exports available without intercepting this module again.
    const original = JSON.stringify(`${id}?hono-vite-build-original`)
    return `export * from ${original}
import { PreparedRegExpRouter } from ${original}
import { MESSAGE_MATCHER_IS_ALREADY_BUILT } from '../../router.js'
export class RegExpRouter extends PreparedRegExpRouter {
  #matcherBuilt = false
  constructor() {
    // Each router needs its own mutable matcher and handler tables.
    super(...${serialized})
    const match = this.match
    this.match = (method, path) => {
      this.#matcherBuilt = true
      return match.call(this, method, path)
    }
  }
  add(method, path, handler) {
    if (this.#matcherBuilt) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT)
    }
    super.add(method, path, handler)
  }
}`
  },
})
