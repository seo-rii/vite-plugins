import { Hono } from 'hono'

const app = new Hono()

app.get('/foo*', (c) => c.text('unauthorized', 401))
app.post('/foo/bar', (c) => c.text('posted'))
app.all('*', (c) => c.text('secret'))

export default app
