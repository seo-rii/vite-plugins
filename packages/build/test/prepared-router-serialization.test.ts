import { build } from 'vite'
import { fileURLToPath } from 'node:url'
import buildPlugin from '../src/base'

const testDir = fileURLToPath(new URL('./mocks/app', import.meta.url))

const buildApp = async (version: string, entry: string, paths: string[], minify: boolean) => {
  const result = await build({
    configFile: false,
    root: testDir,
    logLevel: 'silent',
    resolve: {
      alias: [
        { find: /^hono(?=\/|$)/, replacement: `hono-prepared-${version.replace(/\./g, '-')}` },
      ],
    },
    plugins: [buildPlugin({ entry, minify, preparedRouter: { paths } })],
    build: { write: false, outDir: '.prepared-router-serialization-test-dist' },
  })
  if (Array.isArray(result) || !('output' in result)) {
    throw new Error('Expected a single build output')
  }
  const entryChunk = result.output.find((output) => output.type === 'chunk' && output.isEntry)
  if (!entryChunk || entryChunk.type !== 'chunk') {
    throw new Error('Expected an entry chunk')
  }
  const source = Buffer.from(
    `${entryChunk.code}\n//# sourceURL=prepared-router-serialization-test.mjs`
  ).toString('base64')
  return (await import(/* @vite-ignore */ `data:text/javascript;base64,${source}`)).default as {
    request: (input: string, init?: RequestInit) => Promise<Response>
  }
}

describe.each(
  ['4.9.11', '4.9.12'].flatMap((version) => [false, true].map((minify) => ({ version, minify })))
)(
  'Prepared router serialization with consumer Hono $version (minify $minify)',
  ({ version, minify }) => {
    describe('method matcher dictionaries', () => {
      let app: Awaited<ReturnType<typeof buildApp>>

      beforeAll(async () => {
        app = await buildApp(version, './src/server-prepared-review-methods.ts', ['*'], minify)
        const response = await app.request('/')
        expect(response.status).toBe(200)
        expect(await response.text()).toBe('ok')
      })

      it.each(['constructor', 'toString', '__proto__'])(
        'falls back to the all-method handler for %s after initialization',
        async (method) => {
          const response = await Promise.resolve()
            .then(() => app.request('/', { method }))
            .catch((error: Error) => {
              throw new Error(error.message)
            })
          expect(response.status).toBe(200)
          expect(await response.text()).toBe('ok')
        }
      )
    })

    describe('parameter name dictionaries', () => {
      let app: Awaited<ReturnType<typeof buildApp>>

      beforeAll(async () => {
        app = await buildApp(
          version,
          './src/server-prepared-review-params.ts',
          ['/:__proto__'],
          minify
        )
      })

      it('preserves a parameter named __proto__', async () => {
        const response = await app.request('/foo')
        expect(response.status).toBe(200)
        expect(await response.text()).toBe('foo')
      })
    })
  }
)
