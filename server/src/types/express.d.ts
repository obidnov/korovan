import 'express'

declare global {
  namespace Express {
    interface Request {
      player?: { id: string; nickname: string | null }
    }
  }
}
