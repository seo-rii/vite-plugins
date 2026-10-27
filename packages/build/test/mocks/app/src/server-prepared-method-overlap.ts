import { Hono } from 'hono'

const app = new Hono()

app.get('/foo/:id/*', (c) => c.text('unauthorized', 401))
app.post('/foo/:name', (c) => c.text(`post:${c.req.param('name')}`))
app.all('*', (c) => c.text('fallback'))

export default app
