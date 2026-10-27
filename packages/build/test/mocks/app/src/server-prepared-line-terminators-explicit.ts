import { Hono } from 'hono'
import { RegExpRouter } from 'hono/router/reg-exp-router'

const app = new Hono({ router: new RegExpRouter() })

app.get('/users/:id', (c) => c.json(c.req.param()))
app.get('/optional/:name?', (c) => c.json(c.req.param()))
app.all('/*', (c) => c.text('fallback'))

export default app
