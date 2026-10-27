import type { Plugin } from 'vite'
import { build } from 'vite'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import cloudflareWorkersPlugin from '../src/adapter/cloudflare-workers'
import vercelBuildPlugin from '../src/adapter/vercel'
import type { BuildOptions } from '../src/base'
import buildPlugin from '../src/base'

const testDir = fileURLToPath(new URL('./mocks/app', import.meta.url))
const paths = [
  '/router',
  '/users/:id',
  '/optional/:name?',
  '/wild/*',
  '/all',
  '/submit/:id',
  '/ordered',
  '/instance',
  '/other-instance',
]

const createOptions = (options: BuildOptions = {}): BuildOptions => ({
  entry: './src/server-prepared.ts',
  minify: false,
  preparedRouter: { paths },
  ...options,
})

const buildCode = async (plugin: Plugin, version?: string): Promise<string> => {
  const result = await build({
    configFile: false,
    root: testDir,
    logLevel: 'silent',
    resolve: version
      ? {
          alias: [
            { find: /^hono(?=\/|$)/, replacement: `hono-prepared-${version.replace(/\./g, '-')}` },
          ],
        }
      : undefined,
    plugins: [plugin],
    build: { write: false, outDir: '.prepared-router-test-dist' },
  })
  if (Array.isArray(result) || !('output' in result)) {
    throw new Error('Expected a single build output')
  }
  const entry = result.output.find((output) => output.type === 'chunk' && output.isEntry)
  if (!entry || entry.type !== 'chunk') {
    throw new Error('Expected an entry chunk')
  }
  return entry.code
}

const loadCode = (code: string) => {
  const source = Buffer.from(`${code}\n//# sourceURL=prepared-router-test.mjs`).toString('base64')
  return import(/* @vite-ignore */ `data:text/javascript;base64,${source}`)
}

type BuiltApp = {
  request: (input: string, init?: RequestInit) => Promise<Response>
  fetch: (request: Request) => Promise<Response>
}

describe.each(['4.9.11', '4.9.12'])('Prepared router with consumer Hono %s', (version) => {
  let code: string
  let app: BuiltApp

  beforeAll(async () => {
    code = await buildCode(buildPlugin(createOptions()), version)
    app = (await loadCode(code)).default
  })

  it('prepares the application router and excludes the runtime regexp compiler', async () => {
    expect(await (await app.request('/router')).text()).toBe('SmartRouter + PreparedRegExpRouter')
    expect(code).toContain('PreparedRegExpRouter')
    expect(code).not.toContain('buildInitParams')
    expect(code).not.toContain('buildRegExp')
    expect(code).not.toContain('buildMatcherFromPreprocessedRoutes')
  })

  it('preserves middleware, parameters, optional routes, wildcards, methods and not-found', async () => {
    const cases: [string, RequestInit | undefined, number, string][] = [
      ['/users/alice', undefined, 200, 'user:alice'],
      ['/users/alice%20bob', undefined, 200, 'user:alice bob'],
      ['/optional', undefined, 200, 'anonymous'],
      ['/optional/bob', undefined, 200, 'bob'],
      ['/wild/nested/path', undefined, 200, 'wildcard'],
      ['/wild', undefined, 200, 'wildcard'],
      ['/all', undefined, 200, 'GET'],
      ['/all', { method: 'DELETE' }, 200, 'DELETE'],
      ['/submit/42', { method: 'POST', body: 'payload' }, 200, '42:payload'],
      ['/users/alice', { method: 'HEAD' }, 200, ''],
      ['/ordered', undefined, 200, 'before:handler:after'],
      ['/missing', undefined, 404, 'missing'],
    ]
    for (const [path, init, status, body] of cases) {
      const response = await app.request(path, init)
      expect(response.status, path).toBe(status)
      expect(await response.text(), path).toBe(body)
      expect(response.headers.get('X-Prepared-Middleware'), path).toBe('visited')
    }
  })

  it('keeps handler tables isolated between Hono instances', async () => {
    expect(await (await app.request('/instance')).text()).toBe('first')
    expect(await (await app.request('/other-instance')).text()).toBe('second')
    expect(await (await app.request('/instance')).text()).toBe('first')
  })
})

describe('Prepared router configuration and adapters', () => {
  it('keeps legacy Hono builds working without the option', async () => {
    const code = await buildCode(buildPlugin(createOptions({ preparedRouter: undefined })))
    const app = (await loadCode(code)).default as BuiltApp
    expect(await (await app.request('/router')).text()).toBe('SmartRouter + RegExpRouter')
    expect(code).not.toContain('PreparedRegExpRouter')
  })

  it('explains the Hono requirement when enabled with an unsupported consumer version', async () => {
    await expect(buildCode(buildPlugin(createOptions()))).rejects.toThrow(
      /preparedRouter.*Hono >= 4\.9\.11/
    )
  })

  it('reports paths that the prepared regexp router cannot compile', async () => {
    await expect(
      buildCode(
        buildPlugin(createOptions({ preparedRouter: { paths: ['/:id', '/:name'] } })),
        '4.9.12'
      )
    ).rejects.toThrow(/Cannot compile preparedRouter\.paths/)
  })

  it('reports application paths missing from the manifest on the first request', async () => {
    const code = await buildCode(
      buildPlugin(createOptions({ preparedRouter: { paths: ['/router'] } })),
      '4.9.12'
    )
    const app = (await loadCode(code)).default
    app.onError((error: Error) => new Response(error.message, { status: 500 }))
    const response = await app.request('/router')
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('Path /users/:id is not registered')
  })

  it('preserves the tiny preset router', async () => {
    const code = await buildCode(
      buildPlugin(
        createOptions({
          entry: './src/server-prepared-tiny.ts',
          preset: 'hono/tiny',
          preparedRouter: { paths: ['/router'] },
        })
      ),
      '4.9.12'
    )
    const app = (await loadCode(code)).default as BuiltApp
    expect(await (await app.request('/router')).text()).toBe('PatternRouter')
    expect(code).not.toContain('PreparedRegExpRouter')
  })

  it('preserves explicitly configured custom routers', async () => {
    const code = await buildCode(
      buildPlugin(
        createOptions({
          entry: './src/server-prepared-custom.ts',
          preparedRouter: { paths: ['/router'] },
        })
      ),
      '4.9.12'
    )
    const app = (await loadCode(code)).default as BuiltApp
    expect(await (await app.request('/router')).text()).toBe('TrieRouter')
  })

  it('prepares Vercel function builds', async () => {
    const code = await buildCode(vercelBuildPlugin(createOptions()), '4.9.12')
    const server = createServer((await loadCode(code)).default)
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('Expected a TCP server address')
      }
      const response = await fetch(`http://127.0.0.1:${address.port}/router`)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('SmartRouter + PreparedRegExpRouter')
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  })

  it('preserves Cloudflare Workers handlers alongside the prepared fetch handler', async () => {
    const code = await buildCode(
      cloudflareWorkersPlugin(createOptions({ entry: './src/server-prepared-worker.ts' })),
      '4.9.12'
    )
    const app = (await loadCode(code)).default
    expect(app.scheduled()).toBe('scheduled')
    const response = await app.fetch(new Request('http://localhost/router'))
    expect(await response.text()).toBe('SmartRouter + PreparedRegExpRouter')
  })
})
