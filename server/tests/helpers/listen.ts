import type { Express } from 'express'
import type { Server } from 'http'

export interface ListenHandle {
  server: Server
  close: () => Promise<void>
}

// BOO-507: supertest's default `request(app)` calls `app.listen(0)` on every
// invocation and closes the port when the request completes. Under rapid
// sequential call bursts this races macOS's TIME_WAIT recycling and produces
// sporadic ECONNRESET / 404 / wrong-status responses.
//
// Usage: call listen(app) once in beforeAll, pass handle.server to supertest,
// call handle.close() in afterAll.
export function listen(app: Express): ListenHandle {
  const server = app.listen(0)
  return {
    server,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}
