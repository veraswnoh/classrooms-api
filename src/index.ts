import { Hono } from 'hono'
import courses from './routes/courses';

const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello World!')
})

app.route('/courses', courses)

export default app
