import { build } from 'vite'
import { fileURLToPath } from 'node:url'
import buildPlugin from '../src/base'

const testDir = fileURLToPath(new URL('./mocks/app', import.meta.url))

const buildCode = async (version: string, prepared: boolean) => {
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
        entry: './src/server-prepared-review-wildcard.ts',
        minify: false,
        preparedRouter: prepared ? { paths: ['/foo*', '/foo/bar', '*'] } : undefined,
      }),
    ],
    build: { write: false, outDir: '.prepared-router-wildcards-test-dist' },
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

describe.each(['4.9.11', '4.9.12'])(
  'Prepared router wildcard safety with consumer Hono %s',
  (version) => {
    it('rejects non-segment wildcards whose handlers could be skipped', async () => {
      await expect(buildCode(version, true).then(() => undefined)).rejects.toThrow(
        /preparedRouter\.paths.*wildcard/i
      )
    })

    it('preserves non-segment wildcard handlers when prepared routing is disabled', async () => {
      const source = Buffer.from(
        `${await buildCode(version, false)}\n//# sourceURL=prepared-router-wildcards-test.mjs`
      ).toString('base64')
      const app = (await import(/* @vite-ignore */ `data:text/javascript;base64,${source}`)).default
      const denied = await app.request('/foo/bar')
      expect(denied.status).toBe(401)
      expect(await denied.text()).toBe('unauthorized')

      const posted = await app.request('/foo/bar', { method: 'POST' })
      expect(posted.status).toBe(200)
      expect(await posted.text()).toBe('posted')
    })
  }
)
