import type { LLMProvider, ProviderId, ProviderRegistry } from './types.js'

export function createRegistry(): ProviderRegistry {
  const providers = new Map<ProviderId, LLMProvider>()

  const registry: ProviderRegistry = {
    register(provider: LLMProvider): void {
      if (providers.has(provider.name)) {
        throw new Error(`LLM provider '${provider.name}' is already registered`)
      }
      providers.set(provider.name, provider)
    },

    get(id: ProviderId): LLMProvider {
      const p = providers.get(id)
      if (!p) throw new Error(`LLM provider '${id}' is not registered`)
      return p
    },

    getDefault(): LLMProvider {
      const envId = (process.env['LLM_PROVIDER'] ?? 'deepseek') as ProviderId
      return registry.get(envId)
    },

    list(): ProviderId[] {
      return [...providers.keys()]
    },
  }

  return registry
}
