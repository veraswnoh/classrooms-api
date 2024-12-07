import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => {
  return c.text('Courses!')
})

app.get('/list', (c) => {
    return c.text('Courses list')
})

export default app
