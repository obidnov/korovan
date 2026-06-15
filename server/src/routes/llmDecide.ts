/**
 * POST /api/llm/decide — server-side LLM decision endpoint (EP-3).
 *
 * Auth:      cookieAuth middleware populates req.player upstream → 401 for unauthenticated.
 * Rate-limit: createRateLimiter middleware uses req.ip (trust-proxy-aware) — no manual
 *             XFF parsing here (BOO-509: closed the XFF spoof bypass present in earlier draft).
 */

import type { Router, Request, Response } from 'express'
import { DecideRequestSchema, AgentCommandSchema } from '../llm/schema'
import { createScriptedProvider } from '../llm/scripted'
import { getOrCreateSession, persistSession } from '../llm/aiSessions'
import { createRateLimiter, ENDPOINT_PROFILES } from '../middleware/rateLimit'
import { logger } from '../logger'
import type { LLMProvider, AgentCommand } from '../llm/types'
import { LLMProviderError } from '../llm/types'

const _scripted = createScriptedProvider()
const decideLimiter = createRateLimiter(ENDPOINT_PROFILES['POST /api/llm/decide'])

function isAlertableError(code: string): boolean {
  return code === 'provider-5xx' || code === 'auth' || code === 'network'
}

export function registerLlmDecideRoute(router: Router, provider: LLMProvider): void {
  router.post('/api/llm/decide', decideLimiter, async (req: Request, res: Response): Promise<void> => {
    if (!req.player) {
      res.status(401).json({ error: 'authentication_required' })
      return
    }

    const playerId = req.player.id
    // req.ip is set by Express and honors the app-level trust proxy setting.
    // With app.set('trust proxy', 1), req.ip = proxy-forwarded client IP.
    // Direct clients cannot spoof this via X-Forwarded-For (BOO-509).

    const parseResult = DecideRequestSchema.safeParse(req.body)
    if (!parseResult.success) {
      res.status(400).json({
        error: 'invalid_request',
        details: parseResult.error.flatten(),
      })
      return
    }

    const { faction, snapshot } = parseResult.data

    if (snapshot.faction !== faction) {
      res.status(400).json({ error: 'faction_mismatch' })
      return
    }

    const sessionState = getOrCreateSession(playerId, faction)

    let command: AgentCommand
    let source: 'llm' | 'fallback'
    let sessionTokenCount = 0

    try {
      const output = await provider.decide({
        playerId,
        faction,
        snapshot,
        sessionState,
      })

      const cmdParse = AgentCommandSchema.safeParse(output.command)
      if (!cmdParse.success) {
        logger.warn({
          msg: 'llm-decide:schema-invalid',
          playerId,
          faction,
          issues: cmdParse.error.flatten(),
        })
        const fallbackOut = await _scripted.decide({ playerId, faction, snapshot, sessionState })
        command = fallbackOut.command as AgentCommand
        source = 'fallback'
        persistSession(playerId, faction, sessionState, command)
      } else {
        command = cmdParse.data as AgentCommand
        source = 'llm'
        sessionTokenCount = (output.usage?.promptTokens ?? 0) + (output.usage?.completionTokens ?? 0)
        persistSession(playerId, faction, output.updatedSessionState, command)
      }
    } catch (err) {
      const fallbackOut = await _scripted.decide({ playerId, faction, snapshot, sessionState })
      command = fallbackOut.command as AgentCommand
      source = 'fallback'
      persistSession(playerId, faction, sessionState, command)

      if (err instanceof LLMProviderError) {
        const level = isAlertableError(err.code) ? 'error' : 'warn'
        logger[level]({
          msg: 'llm-decide:provider-error',
          code: err.code,
          httpStatus: err.httpStatus,
          playerId,
          faction,
          alert: isAlertableError(err.code) ? 'CSO-ALERT' : undefined,
        })
      } else {
        logger.error({
          msg: 'llm-decide:unexpected-error',
          playerId,
          faction,
          alert: 'CSO-ALERT',
        })
      }
    }

    res.json({ command, source, session_token_count: sessionTokenCount })
  })
}
