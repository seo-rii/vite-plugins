import { build, createLogger } from 'vite'
import { fileURLToPath } from 'node:url'
import buildPlugin from '../src/base'

const testDir = fileURLToPath(new URL('./mocks/app', import.meta.url))

const fixtures = [
  {
    name: 'method-specific wildcard handlers',
    entry: './src/server-prepared-method-wildcard.ts',
    paths: ['/foo/:id/*', '/foo/:id{[^/]+}', '*'],
    requests: [
      { method: 'GET', path: '/foo/alice', status: 401, body: 'unauthorized' },
      { method: 'GET', path: '/foo/alice/deep', status: 401, body: 'unauthorized' },
      { method: 'POST', path: '/foo/alice', status: 200, body: 'post' },
      { method: 'GET', path: '/unmatched', status: 200, body: 'fallback' },
    ],
  },
  {
    name: 'method-specific parameter names',
    entry: './src/server-prepared-method-params.ts',
    paths: ['/foo/*/bar', '/foo/:userId'],
    requests: [
      { method: 'POST', path: '/foo/alice', status: 200, body: { userId: 'alice' } },
      { method: 'GET', path: '/foo/alice/bar', status: 200, body: 'middle' },
    ],
  },
  {
    name: 'method-specific overlapping wildcard paths',
    entry: './src/server-prepared-method-overlap.ts',
    paths: ['/foo/:id/*', '/foo/:name', '*'],
    requests: [
      { method: 'GET', path: '/foo/alice', status: 401, body: 'unauthorized' },
      { method: 'POST', path: '/foo/alice', status: 200, body: 'post:alice' },
    ],
  },
  {
    name: 'method-specific greedy patterns',
    entry: './src/server-prepared-method-pattern.ts',
    paths: ['/foo/:id{.+}', '/foo/:id{.+}/bar', '*'],
    requests: [{ method: 'POST', path: '/foo/a/bar', status: 200, body: 'post:a' }],
  },
  {
    name: 'method-specific literal markers',
    entry: './src/server-prepared-method-literal.ts',
    paths: ['/a@0/:id', '/a/:id', '*'],
    requests: [{ method: 'POST', path: '/a/x', status: 200, body: 'post:x' }],
  },
  {
    name: 'method-specific alternation literals',
    entry: './src/server-prepared-method-alternation.ts',
    paths: ['/foo|bar/*', '/z/:id', '*'],
    requests: [{ method: 'POST', path: '/fooz/x', status: 200, body: 'fallback' }],
  },
]

const buildApp = async (version: string, entry: string, minify: boolean, paths?: string[]) => {
  const warnings: string[] = []
  const logger = createLogger('silent')
  logger.warn = (message) => warnings.push(message)

  const result = await build({
    configFile: false,
    root: testDir,
    logLevel: 'silent',
    customLogger: logger,
    resolve: {
      alias: [
        { find: /^hono(?=\/|$)/, replacement: `hono-prepared-${version.replace(/\./g, '-')}` },
      ],
    },
    plugins: [buildPlugin({ entry, minify, preparedRouter: paths ? { paths } : undefined })],
    build: { write: false, outDir: '.prepared-router-methods-test-dist' },
  })
  if (Array.isArray(result) || !('output' in result)) {
    throw new Error('Expected a single build output')
  }
  const entryChunk = result.output.find((output) => output.type === 'chunk' && output.isEntry)
  if (!entryChunk || entryChunk.type !== 'chunk') {
    throw new Error('Expected an entry chunk')
  }
  const source = Buffer.from(
    `${entryChunk.code}\n//# sourceURL=prepared-router-methods-test.mjs`
  ).toString('base64')
  const app = (await import(/* @vite-ignore */ `data:text/javascript;base64,${source}`))
    .default as {
    request: (input: string, init?: RequestInit) => Promise<Response>
    router: { name: string }
  }
  return { app, warnings }
}

describe.each(
  ['4.9.11', '4.9.12'].flatMap((version) => [false, true].map((minify) => ({ version, minify })))
)('Prepared router methods with consumer Hono $version (minify $minify)', ({ version, minify }) => {
  describe.each(fixtures)('$name', (fixture) => {
    describe.each([
      { name: 'normal routing', paths: undefined },
      { name: 'prepared routing', paths: fixture.paths },
      {
        name: 'prepared routing with a shared superset manifest',
        paths: [...fixture.paths, '/other-app/:slug'],
      },
    ])('$name', ({ paths }) => {
      let app: Awaited<ReturnType<typeof buildApp>>['app']

      beforeAll(async () => {
        const built = await buildApp(version, fixture.entry, minify, paths)
        app = built.app
        if (paths) {
          expect(built.warnings).toEqual(
            expect.arrayContaining([expect.stringMatching(/Using the original RegExpRouter/)])
          )
        } else {
          expect(built.warnings).toEqual([])
        }
      })

      it.each(fixture.requests)(
        'preserves $method $path',
        async ({ method, path, status, body }) => {
          const response = await Promise.resolve()
            .then(() => app.request(path, { method }))
            .catch((error: Error) => {
              throw new Error(error.message)
            })
          expect(response.status).toBe(status)
          if (typeof body === 'string') {
            expect(await response.text()).toBe(body)
          } else {
            expect(await response.json()).toEqual(body)
          }
          if (paths) {
            expect(app.router.name).not.toContain('PreparedRegExpRouter')
          }
        }
      )
    })
  })
})
