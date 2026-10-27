import { Hono } from 'hono'

const app = new Hono()

app.get('/foo/:id/*', (c) => c.text('unauthorized', 401))
app.post('/foo/:id{[^/]+}', (c) => c.text('post'))
app.all('*', (c) => c.text('fallback'))

export default app
