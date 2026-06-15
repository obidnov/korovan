import { app } from './app'
import { openDb } from './db'
import { validateStartupConfig } from './config'

try {
  validateStartupConfig()
} catch (err) {
  process.stderr.write(`[fatal] ${(err as Error).message}\n`)
  process.exit(1)
}

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
