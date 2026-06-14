# Save-Format Versioning Contract

## On-disk format

Save files are serialized as JSON. The root object is a versioned envelope:

```json
{
  "version": 1,
  "player": { ... },
  "world": { ... },
  "settings": { ... }
}
```

The `version` field is a **literal integer** used by the migration layer to select the correct upgrade path.

## SaveV1 schema

| Field | Type | Notes |
|---|---|---|
| `version` | `1` | Discriminant literal |
| `player.hp` | `number` (int, ≥ 0) | Current hit points |
| `player.position` | `[number, number, number]` | World-space xyz |
| `player.inventory` | `LootItem[]` | `{ id: string; qty: number }` per item |
| `world.caravanState` | `unknown` | Opaque — owned by caravan-state issue |
| `settings.provider` | `ProviderSettings` | See `src/ai/types.ts` |

`ProviderSettings` shape: `{ id, baseUrl, model, apiKey, timeoutMs }`.  
`id` is one of `deepseek | anthropic | openai-compat`.

## Versioning contract

1. **Never mutate a released schema.** Adding a field to SaveV1 that was never there is a breaking change — cut SaveV2 instead.
2. **All new shapes ship with a `migrate` case.** The `migrate(prev: AnyVersion): SaveV1` function in `src/save/schema.ts` is the single upgrade entry point. Each new version adds a case:
   ```ts
   // SaveV2 example:
   if (prev.version === 2) return upgradeV2toV1(prev);
   ```
3. **Loader always migrates before use.** The persistence layer (future issue) calls `migrate(raw)` after `validateSaveV1` fails, then re-validates the result.

## Migration example (future SaveV2 → SaveV1)

```ts
// In src/save/schema.ts when SaveV2 ships:
export type AnyVersion = SaveV1 | SaveV2;

export function migrate(prev: AnyVersion): SaveV1 {
  if (prev.version === 1) return prev;
  if (prev.version === 2) {
    return {
      version: 1,
      // ... map SaveV2 fields to SaveV1 shape
    };
  }
  const _: never = prev; // exhaustiveness guard
  return _ as never;
}
```

## Runtime validation

`validateSaveV1(raw: unknown): SaveV1` throws a `ZodError` on malformed input with field-level error messages. Use it at the persistence boundary before passing save data into game logic.
