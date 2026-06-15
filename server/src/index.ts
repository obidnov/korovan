import { app } from './app'
import { openDb } from './db'

const dbPath = process.env.DB_PATH ?? '/data/korovan.db'
openDb(dbPath)

const port = parseInt(process.env.PORT ?? '8787', 10)

app.listen(port, () => {
  process.stdout.write(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: 'info',
      msg: 'server started',
      port,
    }) + '\n',
  )
})
