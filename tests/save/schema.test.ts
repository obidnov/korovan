import { describe, it, expect } from 'vitest';
import { validateSaveV1, migrate } from '../../src/save/schema.js';

const validPayload = {
  version: 1 as const,
  player: {
    hp: 100,
    position: [0, 1.5, -3] as [number, number, number],
    inventory: [{ id: 'sword', qty: 1 }],
  },
  world: {
    caravanState: {
      stateId: 'active' as const,
      waypointIdx: 0,
      cartPosition: { x: -20, z: -10 },
      respawnCooldownRemaining: 0,
    },
  },
  settings: {
    provider: {
      id: 'deepseek' as const,
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      apiKey: 'sk-test',
      timeoutMs: 5000,
    },
  },
};

describe('validateSaveV1', () => {
  it('round-trips a valid payload', () => {
    const result = validateSaveV1(validPayload);
    expect(result).toEqual(validPayload);
  });

  it('accepts empty inventory', () => {
    const result = validateSaveV1({ ...validPayload, player: { ...validPayload.player, inventory: [] } });
    expect(result.player.inventory).toEqual([]);
  });

  it('accepts null caravanState', () => {
    const result = validateSaveV1({ ...validPayload, world: { caravanState: null } });
    expect(result.world.caravanState).toBeNull();
  });

  it('rejects missing version field', () => {
    const { version: _v, ...noVersion } = validPayload;
    expect(() => validateSaveV1(noVersion)).toThrow();
  });

  it('rejects wrong version literal', () => {
    expect(() => validateSaveV1({ ...validPayload, version: 2 })).toThrow();
  });

  it('rejects negative hp', () => {
    expect(() =>
      validateSaveV1({ ...validPayload, player: { ...validPayload.player, hp: -1 } }),
    ).toThrow();
  });

  it('rejects 2-element position tuple', () => {
    expect(() =>
      validateSaveV1({ ...validPayload, player: { ...validPayload.player, position: [0, 0] } }),
    ).toThrow();
  });

  it('rejects missing provider settings', () => {
    expect(() => validateSaveV1({ ...validPayload, settings: {} })).toThrow();
  });

  it('rejects unknown provider id', () => {
    expect(() =>
      validateSaveV1({
        ...validPayload,
        settings: { provider: { ...validPayload.settings.provider, id: 'gpt4' } },
      }),
    ).toThrow();
  });

  it('rejects non-positive timeoutMs', () => {
    expect(() =>
      validateSaveV1({
        ...validPayload,
        settings: { provider: { ...validPayload.settings.provider, timeoutMs: 0 } },
      }),
    ).toThrow();
  });
});

describe('migrate', () => {
  it('returns identity for v1 (no-op)', () => {
    const save = validateSaveV1(validPayload);
    const result = migrate(save);
    expect(result).toBe(save);
  });

  it('migrated value passes validation', () => {
    const save = validateSaveV1(validPayload);
    expect(() => validateSaveV1(migrate(save))).not.toThrow();
  });
});
