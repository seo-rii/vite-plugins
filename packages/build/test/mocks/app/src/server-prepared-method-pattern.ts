import { Hono } from 'hono'

const app = new Hono()

app.get('/foo/:id{.+}', (c) => c.text(`first:${c.req.param('id')}`))
app.post('/foo/:id{.+}/bar', (c) => c.text(`post:${c.req.param('id')}`))
app.all('*', (c) => c.text('fallback'))

export default app
