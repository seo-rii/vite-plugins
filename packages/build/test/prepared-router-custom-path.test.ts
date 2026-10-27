import { build } from 'vite'
import { fileURLToPath } from 'node:url'
import buildPlugin from '../src/base'

const testDir = fileURLToPath(new URL('./mocks/app', import.meta.url))
const paths = ['/literal', '/users/:id', '/constructor', '/__proto__']
const inheritedKeys = ['constructor', '__proto__', 'toString', 'hasOwnProperty']

const buildApp = async (version: string, minify: boolean, prepared: boolean) => {
  const result = await build({
    configFile: false,
    root: testDir,
    logLevel: 'silent',
    resolve: {
      alias: [
        { find: /^hono(?=\/|$)/, replacement: `hono-prepared-${version.replace(/\./g, '-')}` },
      ],
    },
    plugins: [
      buildPlugin({
        entry: './src/server-prepared-custom-path.ts',
        minify,
        preparedRouter: prepared ? { paths } : undefined,
        entryContentBeforeHooks: [
          (app) => `${app}.onError((error, c) => c.text(error.message, 500))`,
        ],
      }),
    ],
    build: { write: false, outDir: '.prepared-router-custom-path-test-dist' },
  })
  if (Array.isArray(result) || !('output' in result)) {
    throw new Error('Expected a single build output')
  }
  const chunk = result.output.find((output) => output.type === 'chunk' && output.isEntry)
  if (!chunk || chunk.type !== 'chunk') {
    throw new Error('Expected an entry chunk')
  }
  const source = Buffer.from(
    `${chunk.code}\n//# sourceURL=prepared-router-custom-path-${version}-${minify}-${prepared}.mjs`
  ).toString('base64')
  const app = (await import(/* @vite-ignore */ `data:text/javascript;base64,${source}`))
    .default as {
    request: (input: string, init?: RequestInit) => Promise<Response>
    router: { name: string }
  }
  return { app, code: chunk.code }
}

describe.each(
  ['4.9.11', '4.9.12'].flatMap((version) =>
    [false, true].flatMap((minify) =>
      [false, true].map((prepared) => ({ version, minify, prepared }))
    )
  )
)(
  'Prepared router custom paths with Hono $version (minify $minify, prepared $prepared)',
  ({ version, minify, prepared }) => {
    let app: Awaited<ReturnType<typeof buildApp>>['app']
    let code: string

    beforeAll(async () => {
      const built = await buildApp(version, minify, prepared)
      app = built.app
      code = built.code
    })

    it('preserves a prototype-named hostname on the first lookup', async () => {
      const response = await app.request('http://constructor/')
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('GET:constructor')
      expect(response.headers.get('X-Routing-Order')).toBe('before:get:all:after')
    })

    it('preserves normal and prototype-named hostnames on subsequent lookups', async () => {
      for (const host of ['__proto__', 'example.com', 'constructor']) {
        const response = await app.request(`http://${host}/`)
        expect(response.status, host).toBe(200)
        expect(await response.text()).toBe(`GET:${host}`)
        expect(response.headers.get('X-Routing-Order')).toBe('before:get:all:after')
      }
    })

    it.each(inheritedKeys)('preserves method handlers and ALL order for %s', async (path) => {
      for (const method of ['GET', 'POST', 'DELETE', 'PATCH']) {
        const response = await app.request('/', {
          method,
          headers: { 'X-Routing-Path': path },
        })
        expect(response.status, `${method} ${path}`).toBe(200)
        expect(await response.text()).toBe(`${method}:${path}`)
        const methodOrder = method === 'GET' ? 'get:' : method === 'POST' ? 'post:' : ''
        expect(response.headers.get('X-Routing-Order')).toBe(`before:${methodOrder}all:after`)
      }
    })

    it('preserves canonical static routes and parameter captures', async () => {
      for (const [path, body, order] of [
        ['/literal', 'literal', 'literal'],
        ['/constructor', 'own constructor', 'static'],
        ['/__proto__', 'own __proto__', 'static'],
      ]) {
        const response = await app.request('/', { headers: { 'X-Routing-Path': path } })
        expect(response.status).toBe(200)
        expect(await response.text()).toBe(body)
        expect(response.headers.get('X-Routing-Order')).toBe(`before:get:${order}:after`)
      }
      const response = await app.request('/', {
        method: 'POST',
        headers: { 'X-Routing-Path': '/users/alice' },
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ id: 'alice' })
      expect(response.headers.get('X-Routing-Order')).toBe('before:post:parameter:after')
    })

    it('preserves ordinary custom strings with the global wildcard alias', async () => {
      const response = await app.request('/', {
        method: 'POST',
        headers: { 'X-Routing-Path': 'tenant-a' },
      })
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('POST:tenant-a')
      expect(response.headers.get('X-Routing-Order')).toBe('before:post:all:after')
    })

    it('keeps eligible routing prepared and excludes the runtime compiler', () => {
      expect(app.router.name.includes('PreparedRegExpRouter')).toBe(prepared)
      if (prepared) {
        expect(code).not.toContain('buildInitParams')
        expect(code).not.toContain('buildMatcherFromPreprocessedRoutes')
      }
    })
  }
)
