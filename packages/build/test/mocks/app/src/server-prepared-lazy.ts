import { Hono } from 'hono'
import { RegExpRouter } from 'hono/router/reg-exp-router'

const app = new Hono()
app.onError((error, c) => c.text(error.message, 500))
const children: Hono[] = []

for (let index = 0; index < 20; index++) {
  const child = new Hono()
  child.onError((error, c) => c.text(`child: ${error.message}`, 500))
  for (let route = 0; route < 3; route++) {
    child.get(`/item${route}`, (c) => c.text(`child${index}:${route}`))
  }
  children.push(child)
  app.route(`/group${index}`, child)
}

const other = new Hono()
other.get('/shared', (c) => c.text('other'))

const explicit = new Hono({ router: new RegExpRouter() })
explicit.get('/shared', (c) => c.text('explicit'))

const invalid = new Hono()
invalid.onError((error, c) => c.text(error.message, 500))
invalid.get('/not-in-manifest', (c) => c.text('unlisted'))

app.get('/shared', (c) => c.text('root'))
app.get('/use-other', () => other.request('/shared'))
app.get('/use-explicit', () => explicit.request('/shared'))
app.get('/use-child', () => children[0].request('/item0'))
app.get('/use-invalid', () => invalid.request('/not-in-manifest'))

export default app
