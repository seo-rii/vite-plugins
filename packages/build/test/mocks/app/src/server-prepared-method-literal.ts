import { Hono } from 'hono'

const app = new Hono()

app.get('/a@0/:id', (c) => c.text('first'))
app.post('/a/:id', (c) => c.text(`post:${c.req.param('id')}`))
app.all('*', (c) => c.text('fallback'))

export default app
