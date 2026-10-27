import { build } from 'vite'
import { fileURLToPath } from 'node:url'
import buildPlugin from '../src/base'

const testDir = fileURLToPath(new URL('./mocks/app', import.meta.url))
const paths = [
  '/first',
  '/second',
  '/router',
  '/register',
  '/register-route',
  '/register-middleware',
  '/initialize-other',
  '/smart-first',
  '/smart-register',
  '/smart-second',
]
const alreadyBuilt = 'Can not add a route since the matcher is already built.'

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
        entry: './src/server-prepared-lifecycle.ts',
        minify,
        preparedRouter: prepared ? { paths } : undefined,
      }),
    ],
    build: { write: false, outDir: '.prepared-router-lifecycle-test-dist' },
  })
  if (Array.isArray(result) || !('output' in result)) {
    throw new Error('Expected a single build output')
  }
  const entry = result.output.find((output) => output.type === 'chunk' && output.isEntry)
  if (!entry || entry.type !== 'chunk') {
    throw new Error('Expected an entry chunk')
  }
  const source = Buffer.from(
    `${entry.code}\n//# sourceURL=prepared-router-lifecycle-${version}-${minify}-${prepared}.mjs`
  ).toString('base64')
  const app = (await import(/* @vite-ignore */ `data:text/javascript;base64,${source}`))
    .default as {
    request: (input: string, init?: RequestInit) => Promise<Response>
  }
  return { app, code: entry.code }
}

describe.each(
  ['4.9.11', '4.9.12'].flatMap((version) =>
    [false, true].flatMap((minify) =>
      [false, true].map((prepared) => ({ version, minify, prepared }))
    )
  )
)(
  'Router lifecycle with Hono $version (minify $minify, prepared $prepared)',
  ({ version, minify, prepared }) => {
    let app: Awaited<ReturnType<typeof buildApp>>['app']
    let code: string

    beforeAll(async () => {
      const built = await buildApp(version, minify, prepared)
      app = built.app
      code = built.code
      const response = await app.request('/first')
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('first')
    })

    it('uses the selected router without retaining the runtime compiler', async () => {
      const response = await app.request('/router')
      expect(await response.text()).toBe(prepared ? 'PreparedRegExpRouter' : 'RegExpRouter')
      if (prepared) {
        expect(code).not.toContain('buildInitParams')
        expect(code).not.toContain('buildMatcherFromPreprocessedRoutes')
      }
    })

    it('rejects an already-manifested route after the first request', async () => {
      expect((await app.request('/second')).status).toBe(404)
      const response = await app.request('/register-route')
      expect(response.status).toBe(409)
      expect(await response.text()).toBe(alreadyBuilt)
      expect((await app.request('/second')).status).toBe(404)
    })

    it('rejects late middleware without changing later requests', async () => {
      const response = await app.request('/register-middleware')
      expect(response.status).toBe(409)
      expect(await response.text()).toBe(alreadyBuilt)
      const missing = await app.request('/missing', { method: 'POST' })
      expect(missing.status).toBe(404)
      expect(missing.headers.get('X-Late-Middleware')).toBeNull()
    })

    it('keeps an uninitialized second router open for registration', async () => {
      const response = await app.request('/initialize-other')
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('other')
    })

    it('preserves the default SmartRouter registration guard', async () => {
      expect(await (await app.request('/smart-first')).text()).toBe('smart')
      const response = await app.request('/smart-register')
      expect(response.status).toBe(409)
      expect(await response.text()).toBe(alreadyBuilt)
      expect((await app.request('/smart-second')).status).toBe(404)
    })
  }
)
