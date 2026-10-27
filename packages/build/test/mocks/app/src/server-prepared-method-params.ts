import { Hono } from 'hono'

const app = new Hono()

app.get('/foo/*/bar', (c) => c.text('middle'))
app.post('/foo/:userId', (c) => c.json(c.req.param()))

export default app
