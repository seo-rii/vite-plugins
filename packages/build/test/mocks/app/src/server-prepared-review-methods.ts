import { Hono } from 'hono'

const app = new Hono()

app.all('*', (c) => c.text('ok'))
app.onError((error, c) => c.text(error.message, 500))

export default app
