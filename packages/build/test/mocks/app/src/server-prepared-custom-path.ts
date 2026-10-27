import { Hono } from 'hono'

const app = new Hono<{ Variables: { order: string[] } }>({
  getPath: (request) => request.headers.get('X-Routing-Path') ?? new URL(request.url).hostname,
})

app.use('*', async (c, next) => {
  c.set('order', ['before'])
  await next()
  c.get('order').push('after')
  c.header('X-Routing-Order', c.get('order').join(':'))
})
app.get('*', async (c, next) => {
  c.get('order').push('get')
  await next()
})
app.post('/*', async (c, next) => {
  c.get('order').push('post')
  await next()
})
app.get('/literal', (c) => {
  c.get('order').push('literal')
  return c.text('literal')
})
app.post('/users/:id', (c) => {
  c.get('order').push('parameter')
  return c.json(c.req.param())
})
app.get('/constructor', (c) => {
  c.get('order').push('static')
  return c.text('own constructor')
})
app.get('/__proto__', (c) => {
  c.get('order').push('static')
  return c.text('own __proto__')
})
app.all('*', (c) => {
  c.get('order').push('all')
  return c.text(`${c.req.method}:${c.req.path}`)
})

export default app
