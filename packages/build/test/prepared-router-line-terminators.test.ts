import { build } from 'vite'
import { fileURLToPath } from 'node:url'
import buildPlugin from '../src/base'

const testDir = fileURLToPath(new URL('./mocks/app', import.meta.url))
const paths = ['/users/:id', '/optional/:name?']
const lineTerminators = [
  { name: 'LF', encoded: '%0A', decoded: '\n' },
  { name: 'CR', encoded: '%0D', decoded: '\r' },
  { name: 'CRLF', encoded: '%0D%0A', decoded: '\r\n' },
  { name: 'line separator', encoded: '%E2%80%A8', decoded: '\u2028' },
  { name: 'paragraph separator', encoded: '%E2%80%A9', decoded: '\u2029' },
]

const buildApp = async (version: string, entry: string, minify: boolean, manifest?: string[]) => {
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
      buildPlugin({ entry, minify, preparedRouter: manifest ? { paths: manifest } : undefined }),
    ],
    build: { write: false, outDir: '.prepared-router-line-terminators-test-dist' },
  })
  if (Array.isArray(result) || !('output' in result)) {
    throw new Error('Expected a single build output')
  }
  const chunk = result.output.find((output) => output.type === 'chunk' && output.isEntry)
  if (!chunk || chunk.type !== 'chunk') {
    throw new Error('Expected an entry chunk')
  }
  const source = Buffer.from(
    `${chunk.code}\n//# sourceURL=prepared-router-line-terminators-test.mjs`
  ).toString('base64')
  const app = (await import(/* @vite-ignore */ `data:text/javascript;base64,${source}`))
    .default as {
    request: (input: string, init?: RequestInit) => Promise<Response>
    router: { name: string }
  }
  return { app, code: chunk.code }
}

describe.each(
  ['4.9.11', '4.9.12'].flatMap((version) => [false, true].map((minify) => ({ version, minify })))
)(
  'Prepared router line terminators with consumer Hono $version (minify $minify)',
  ({ version, minify }) => {
    describe.each([
      { name: 'default SmartRouter', entry: './src/server-prepared-line-terminators.ts' },
      {
        name: 'explicit RegExpRouter',
        entry: './src/server-prepared-line-terminators-explicit.ts',
      },
    ])('$name', ({ entry }) => {
      describe.each([
        { name: 'normal routing', manifest: undefined },
        { name: 'prepared routing', manifest: paths },
        { name: 'shared manifest', manifest: [...paths, '/other-app/:slug'] },
      ])('$name', ({ manifest }) => {
        let app: Awaited<ReturnType<typeof buildApp>>['app']

        beforeAll(async () => {
          const built = await buildApp(version, entry, minify, manifest)
          app = built.app
          if (manifest) {
            expect(built.code).not.toContain('buildInitParams')
            expect(built.code).not.toContain('buildMatcherFromPreprocessedRoutes')
          }
        })

        it('preserves an encoded line terminator on the first lookup', async () => {
          const response = await app.request('/users/a%0Ab', { method: 'POST' })
          expect(response.status).toBe(404)
          expect(await response.text()).toBe('404 Not Found')
        })

        it('preserves ordinary routing and keeps eligible manifests prepared', async () => {
          expect(await (await app.request('/users/alice')).json()).toEqual({ id: 'alice' })
          expect(await (await app.request('/optional')).json()).toEqual({})
          expect(await (await app.request('/optional/bob')).json()).toEqual({ name: 'bob' })
          const response = await app.request('/users/alice', { method: 'POST' })
          expect(response.status).toBe(200)
          expect(await response.text()).toBe('fallback')
          if (manifest) {
            expect(app.router.name).toContain('PreparedRegExpRouter')
          }
        })

        it.each(lineTerminators)(
          'preserves methods with encoded $name',
          async ({ encoded, decoded }) => {
            for (const suffix of ['b', '']) {
              for (const [base, key] of [
                ['/users', 'id'],
                ['/optional', 'name'],
              ]) {
                const input = `${base}/a${encoded}${suffix}`
                const matched = await app.request(input)
                expect(matched.status, input).toBe(200)
                expect(await matched.json()).toEqual({ [key]: `a${decoded}${suffix}` })
                const unmatchedMethod = await app.request(input, { method: 'POST' })
                expect(unmatchedMethod.status, input).toBe(404)
                expect(await unmatchedMethod.text()).toBe('404 Not Found')
              }
              const otherApp = await app.request(`/other-app/a${encoded}${suffix}`, {
                method: 'POST',
              })
              expect(otherApp.status).toBe(404)
              expect(await otherApp.text()).toBe('404 Not Found')
            }
          }
        )
      })
    })
  }
)
