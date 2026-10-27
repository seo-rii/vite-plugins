import { Hono } from 'hono'

const app = new Hono()

app.get('/users/:id', (c) => c.json(c.req.param()))
app.get('/optional/:name?', (c) => c.json(c.req.param()))
app.all('*', (c) => c.text('fallback'))

export default app
