/**
 * POST /api/llm/decide — server-side LLM decision endpoint (BOO-474 / EP-3).
 *
 * Auth: kr_pid cookie required → 401 otherwise.
 * Validates request body with Zod, calls LLMProvider.decide(), falls back to
 * scripted command on any provider failure. Client never sees upstream errors.
 */

import type { Router, Request, Response } from 'express'
import { DecideRequestSchema, AgentCommandSchema } from '../llm/schema'
import { scriptedFallback } from '../llm/fallback'
import { getOrCreateSession, persistSession } from '../llm/aiSessions'
import { checkAndRecord } from '../llm/rateLimiter'
import { logger } from '../logger'
import type { LLMProvider, AgentCommand } from '../llm/types'
import { LLMProviderError } from '../llm/types'

function getClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for']
  if (typeof xff === 'string') return xff.split(',')[0]?.trim() ?? 'unknown'
  return req.socket.remoteAddress ?? 'unknown'
}

function isAlertableError(code: string): boolean {
  return code === 'provider-5xx' || code === 'auth' || code === 'network'
}

export function registerLlmDecideRoute(router: Router, provider: LLMProvider): void {
  router.post('/api/llm/decide', async (req: Request, res: Response): Promise<void> => {
    // --- Auth gate ---
    if (!req.player) {
      res.status(401).json({ error: 'authentication_required' })
      return
    }

    const playerId = req.player.id
    const ip = getClientIp(req)

    // --- Rate limit ---
    if (!checkAndRecord(playerId, ip)) {
      res.status(429).json({ error: 'rate_limit_exceeded' })
      return
    }

    // --- Request body validation ---
    const parseResult = DecideRequestSchema.safeParse(req.body)
    if (!parseResult.success) {
      res.status(400).json({
        error: 'invalid_request',
        details: parseResult.error.flatten(),
      })
      return
    }

    const { faction, snapshot } = parseResult.data

    // Ensure snapshot.faction matches the request faction (prevents faction spoofing)
    if (snapshot.faction !== faction) {
      res.status(400).json({ error: 'faction_mismatch' })
      return
    }

    // --- Load or create AI session ---
    const sessionState = getOrCreateSession(playerId, faction)

    // --- Call LLM provider ---
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

      // Validate LLM output against strict AgentCommand schema
      const cmdParse = AgentCommandSchema.safeParse(output.command)
      if (!cmdParse.success) {
        // schema-invalid — use fallback, log as warning
        logger.warn({
          msg: 'llm-decide:schema-invalid',
          playerId,
          faction,
          issues: cmdParse.error.flatten(),
        })
        command = scriptedFallback(faction)
        source = 'fallback'
        persistSession(playerId, faction, sessionState, command)
      } else {
        command = cmdParse.data as AgentCommand
        source = 'llm'
        sessionTokenCount = (output.usage?.promptTokens ?? 0) + (output.usage?.completionTokens ?? 0)
        persistSession(playerId, faction, output.updatedSessionState, command)
      }
    } catch (err) {
      // Any provider failure → fallback; client never sees the upstream error
      command = scriptedFallback(faction)
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
          // Never log raw error message (may contain auth context)
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
