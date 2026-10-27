import { Hono } from 'hono'
import { RegExpRouter } from 'hono/router/reg-exp-router'

const app = new Hono({ router: new RegExpRouter() })
const other = new Hono({ router: new RegExpRouter() })
const smart = new Hono()

app.get('/first', (c) => c.text('first'))
app.get('/router', (c) => c.text(app.router.name))
app.get('/register-route', (c) => {
  try {
    app.get('/second', (c) => c.text('second'))
    return c.text('registered')
  } catch (error) {
    return c.text((error as Error).message, 409)
  }
})
app.get('/register-middleware', (c) => {
  try {
    app.use('*', async (c, next) => {
      c.header('X-Late-Middleware', 'registered')
      await next()
    })
    return c.text('registered')
  } catch (error) {
    return c.text((error as Error).message, 409)
  }
})
app.get('/initialize-other', () => {
  other.get('/second', (c) => c.text('other'))
  return other.request('/second')
})

smart.get('/first', (c) => c.text('smart'))
smart.get('/register', (c) => {
  try {
    smart.get('/second', (c) => c.text('smart second'))
    return c.text('registered')
  } catch (error) {
    return c.text((error as Error).message, 409)
  }
})
app.get('/smart-first', () => smart.request('/first'))
app.get('/smart-register', () => smart.request('/register'))
app.get('/smart-second', () => smart.request('/second'))

export default app
