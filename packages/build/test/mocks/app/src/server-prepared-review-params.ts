import { Hono } from 'hono'

const app = new Hono()

app.get('/:__proto__', (c) => c.text(c.req.param('__proto__') ?? 'missing'))

export default app
