import { Hono } from 'hono'

const app = new Hono()

app.get('/foo|bar/*', (c) => c.text('first'))
app.post('/z/:id', (c) => c.text(`post:${c.req.param('id')}`))
app.all('*', (c) => c.text('fallback'))

export default app
