import { describe, it, expect } from 'vitest';
import { validateSaveV1, migrate } from '../../src/save/schema.js';

// Post-BOO-485: settings.provider is optional (provider config is server-side per P0-3/P0-4).
// Old saves include provider; new saves omit it. Both must parse cleanly.

const validPayloadLegacy = {
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

const validPayloadNew = {
  version: 1 as const,
  player: {
    hp: 100,
    position: [0, 1.5, -3] as [number, number, number],
    inventory: [],
  },
  world: {
    caravanState: null,
  },
};

describe('validateSaveV1', () => {
  it('round-trips a valid legacy payload (with settings.provider)', () => {
    const result = validateSaveV1(validPayloadLegacy);
    expect(result.version).toBe(1);
    expect(result.player.hp).toBe(100);
  });

  it('accepts new payload without settings field (post-BOO-485)', () => {
    const result = validateSaveV1(validPayloadNew);
    expect(result.version).toBe(1);
    expect(result.settings).toBeUndefined();
  });

  it('accepts payload with settings but no provider', () => {
    const result = validateSaveV1({ ...validPayloadNew, settings: {} });
    expect(result.version).toBe(1);
  });

  it('accepts empty inventory', () => {
    const result = validateSaveV1({ ...validPayloadLegacy, player: { ...validPayloadLegacy.player, inventory: [] } });
    expect(result.player.inventory).toEqual([]);
  });

  it('accepts null caravanState', () => {
    const result = validateSaveV1({ ...validPayloadLegacy, world: { caravanState: null } });
    expect(result.world.caravanState).toBeNull();
  });

  it('rejects missing version field', () => {
    const { version: _v, ...noVersion } = validPayloadLegacy;
    expect(() => validateSaveV1(noVersion)).toThrow();
  });

  it('rejects wrong version literal', () => {
    expect(() => validateSaveV1({ ...validPayloadLegacy, version: 2 })).toThrow();
  });

  it('rejects negative hp', () => {
    expect(() =>
      validateSaveV1({ ...validPayloadLegacy, player: { ...validPayloadLegacy.player, hp: -1 } }),
    ).toThrow();
  });

  it('rejects 2-element position tuple', () => {
    expect(() =>
      validateSaveV1({ ...validPayloadLegacy, player: { ...validPayloadLegacy.player, position: [0, 0] } }),
    ).toThrow();
  });
});

describe('migrate', () => {
  it('returns identity for v1 (no-op)', () => {
    const save = validateSaveV1(validPayloadLegacy);
    const result = migrate(save);
    expect(result).toBe(save);
  });

  it('migrated value passes validation', () => {
    const save = validateSaveV1(validPayloadLegacy);
    expect(() => validateSaveV1(migrate(save))).not.toThrow();
  });
});
