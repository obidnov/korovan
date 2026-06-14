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
2. **Migration is always forward** — old on-disk data is upgraded to `SaveCurrent` (the latest type). `SaveCurrent` is a re-aliased type that always points to the newest version. Each new version adds an upgrade case to `migrate`:
   ```ts
   // When SaveV2 ships — upgrade v1 → v2:
   if (prev.version === 1) return { ...prev, version: 2, player: { ...prev.player, region: 'default' } };
   ```
3. **Loader always migrates before use.** The persistence layer (future issue) calls `migrate(raw)` on the raw parsed JSON, then validates the result as `SaveCurrent`.

## Migration example (SaveV1 → future SaveV2)

```ts
// In src/save/schema.ts when SaveV2 ships (e.g. adds player.region):
export type SaveV2 = { version: 2; player: { region: string } & Omit<SaveV1['player'], never>; /* ... */ };
export type AnyVersion = SaveV1 | SaveV2;
export type SaveCurrent = SaveV2; // bump the alias

export function migrate(prev: AnyVersion): SaveCurrent {
  if (prev.version === 2) return prev;           // already current
  if (prev.version === 1) {
    return {
      ...prev,
      version: 2,
      player: { ...prev.player, region: 'default' }, // fill added field with default
    };
  }
  const _: never = prev; // exhaustiveness guard
  return _ as never;
}
```

## Runtime validation

`validateSaveV1(raw: unknown): SaveV1` throws a `ZodError` on malformed input with field-level error messages. Use it at the persistence boundary before passing save data into game logic.
