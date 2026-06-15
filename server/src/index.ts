import { app } from './app'

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
