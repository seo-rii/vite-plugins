import { build, normalizePath } from 'vite'
import { fileURLToPath } from 'node:url'
import buildPlugin from '../src/base'

const testDir = fileURLToPath(new URL('./mocks/app', import.meta.url))
const probeModule = normalizePath(
  fileURLToPath(new URL('./mocks/app/src/server-prepared-lazy-probe.ts', import.meta.url))
)
const paths = [
  ...Array.from({ length: 3 }, (_, route) => `/item${route}`),
  ...Array.from({ length: 20 }, (_, index) =>
    Array.from({ length: 3 }, (_, route) => `/group${index}/item${route}`)
  ).flat(),
  '/shared',
  '/use-other',
  '/use-explicit',
  '/use-child',
  '/use-invalid',
]

const buildApp = async (version: string, minify: boolean) => {
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
      {
        name: 'count-prepared-router-allocations',
        transform(code, id) {
          if (!/\/reg-exp-router\/prepared-router\.js$/.test(id)) {
            return
          }
          // Count the consumer's actual matcher allocations rather than assert
          // timing or heap thresholds that vary across CI environments.
          return `import { probe } from ${JSON.stringify(probeModule)}\n${code.replace(
            'constructor(matchers, relocateMap) {',
            'constructor(matchers, relocateMap) { probe.allocations++'
          )}`
        },
      },
      buildPlugin({
        entry: './src/server-prepared-lazy.ts',
        minify,
        preparedRouter: { paths },
        entryContentDefaultExportHook: (appName) =>
          `import { probe } from ${JSON.stringify(probeModule)}\nexport default { app: ${appName}, probe }`,
      }),
    ],
    build: { write: false, outDir: '.prepared-router-lazy-test-dist' },
  })
  if (Array.isArray(result) || !('output' in result)) {
    throw new Error('Expected a single build output')
  }
  const chunk = result.output.find((output) => output.type === 'chunk' && output.isEntry)
  if (!chunk || chunk.type !== 'chunk') {
    throw new Error('Expected an entry chunk')
  }
  const source = Buffer.from(
    `${chunk.code}\n//# sourceURL=prepared-router-lazy-${version}-${minify}.mjs`
  ).toString('base64')
  const built = (await import(/* @vite-ignore */ `data:text/javascript;base64,${source}`))
    .default as {
    app: { request: (input: string, init?: RequestInit) => Promise<Response> }
    probe: { allocations: number }
  }
  return { ...built, code: chunk.code }
}

describe.each(
  ['4.9.11', '4.9.12'].flatMap((version) => [false, true].map((minify) => ({ version, minify })))
)(
  'Prepared router lazy initialization with Hono $version (minify $minify)',
  ({ version, minify }) => {
    let built: Awaited<ReturnType<typeof buildApp>>

    beforeAll(async () => {
      built = await buildApp(version, minify)
    })

    it('does not allocate matcher tables while unused Hono applications are created', () => {
      expect(built.probe.allocations).toBe(0)
      expect(built.code).not.toContain('buildInitParams')
      expect(built.code).not.toContain('buildMatcherFromPreprocessedRoutes')
    })

    it('initializes only the generated entry and root router on their first request', async () => {
      const response = await built.app.request('/group0/item0')
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('child0:0')
      expect(built.probe.allocations).toBe(2)
    })

    it('keeps hot requests from allocating more matcher tables', async () => {
      const allocations = built.probe.allocations
      expect(await (await built.app.request('/group19/item2')).text()).toBe('child19:2')
      expect(await (await built.app.request('/shared')).text()).toBe('root')
      expect(built.probe.allocations).toBe(allocations)
    })

    it('initializes an independent application on demand without sharing its handlers', async () => {
      const allocations = built.probe.allocations
      expect(await (await built.app.request('/use-other')).text()).toBe('other')
      expect(built.probe.allocations).toBe(allocations + 1)
      expect(await (await built.app.request('/shared')).text()).toBe('root')
      expect(await (await built.app.request('/use-other')).text()).toBe('other')
      expect(built.probe.allocations).toBe(allocations + 1)
    })

    it('initializes a mounted child router only when it is dispatched directly', async () => {
      const allocations = built.probe.allocations
      expect(await (await built.app.request('/use-child')).text()).toBe('child0:0')
      expect(built.probe.allocations).toBe(allocations + 1)
      expect(await (await built.app.request('/group0/item0')).text()).toBe('child0:0')
      expect(built.probe.allocations).toBe(allocations + 1)
    })

    it('defers an explicit router with registered routes until its first lookup', async () => {
      const allocations = built.probe.allocations
      expect(await (await built.app.request('/use-explicit')).text()).toBe('explicit')
      expect(built.probe.allocations).toBe(allocations + 1)
      expect(await (await built.app.request('/shared')).text()).toBe('root')
      expect(await (await built.app.request('/use-explicit')).text()).toBe('explicit')
      expect(built.probe.allocations).toBe(allocations + 1)
    })

    it('reports an unlisted path only when the corresponding application initializes', async () => {
      const response = await built.app.request('/use-invalid')
      expect(response.status).toBe(500)
      expect(await response.text()).toBe('Path /not-in-manifest is not registered')
    })
  }
)
