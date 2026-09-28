import { describe, it, expect } from 'vitest';
import { AirQualityCard } from '../src/air-quality-card.js';
import { buildEntitySuggestion } from '../src/entity-suggestion.js';

// The air quality card answers to two element names since wilsto/air-quality-card#3:
// the disputed `air-quality-card`, kept for existing configurations, and this
// canonical one, which is what the picker and the suggestion advertise.
const AIR = 'air-monitor-card';

// Home Assistant 2026.6 lets a custom card offer itself when the user picks an
// entity. The documented rule is "only suggest your card when it makes sense",
// and the failure mode is a picker full of cards that cannot render the reading.
//
// So these tests care as much about what is NOT suggested as about what is.

const cards = () =>
  Object.fromEntries((globalThis.window?.customCards ?? []).map(c => [c.type, c]));

const suggest = (cardType, entityId, attributes = {}) => {
  const card = cards()[cardType];
  const hass = { states: { [entityId]: { state: '1', attributes } } };
  return card.getEntitySuggestion(hass, entityId);
};

describe('the air quality card registers a suggestion function', () => {
  it('opts in', () => {
    expect(typeof cards()[AIR]?.getEntitySuggestion).toBe('function');
  });
});

describe('what Home Assistant already knows wins', () => {
  it('a carbon monoxide sensor suggests the air quality card on its co preset', () => {
    const s = suggest(AIR, 'sensor.hallway', { device_class: 'carbon_monoxide' });
    expect(s.config.type).toBe(`custom:${AIR}`);
    expect(s.config.sensors).toEqual({ co: { entity: 'sensor.hallway' } });
  });

  it('a device class the card has no preset for suggests nothing', () => {
    // air-quality has no ozone preset, so it must not claim an ozone sensor
    expect(suggest(AIR, 'sensor.outside', { device_class: 'ozone' })).toBeNull();
  });

  // The card registry has the last word, so a mapping typo cannot produce a
  // config the card is unable to render. Exercised directly: every mapping we
  // ship today points at a preset that exists, which would leave this guard
  // untested and free to rot.
  it('a mapping that points at a preset the card does not have is ignored', () => {
    const broken = buildEntitySuggestion(
      AIR,
      AirQualityCard.SENSORS,
      { temperature: 'temperatuer' },
      [],
    );
    const hass = {
      states: { 'sensor.x': { state: '1', attributes: { device_class: 'temperature' } } },
    };
    expect(broken(hass, 'sensor.x')).toBeNull();
  });

  it('and a mapping that points at a real preset still works', () => {
    const ok = buildEntitySuggestion(
      AIR,
      AirQualityCard.SENSORS,
      { temperature: 'temperature' },
      [],
    );
    const hass = {
      states: { 'sensor.x': { state: '1', attributes: { device_class: 'temperature' } } },
    };
    expect(ok(hass, 'sensor.x').config.sensors).toEqual({ temperature: { entity: 'sensor.x' } });
  });
});

describe('the measurements Home Assistant has no device class for', () => {
  it('reads the preset out of the entity id', () => {
    expect(suggest(AIR, 'sensor.living_room_pm25').config.sensors).toEqual({
      pm25: { entity: 'sensor.living_room_pm25' },
    });
  });

  it('matches a multi word preset', () => {
    expect(suggest(AIR, 'sensor.living_room_formaldehyde').config.sensors).toEqual({
      formaldehyde: { entity: 'sensor.living_room_formaldehyde' },
    });
  });

  // These two entity ids contain a preset key as a substring but not as a word:
  // "corporate" contains "co" without it being a measurement key. A plain
  // `includes` would claim an office energy meter as a carbon monoxide probe.
  it('matches on whole words, so a corporate meter is not a carbon monoxide probe', () => {
    expect(suggest(AIR, 'sensor.corporate_power')).toBeNull();
    // and the real thing still matches
    expect(suggest(AIR, 'sensor.indoor_co').config.sensors).toEqual({
      co: { entity: 'sensor.indoor_co' },
    });
  });

  // Found on the bench, not here: the unit test below supplied a device_class,
  // so it never exercised the path a real sensor takes. The bench's CO sensor
  // has no device class at all, which is the normal case for a reading fed in
  // through a bridge or a template, and is exactly @renevelasco123's setup on
  // air-quality-card#5. The card offered nothing.
  it('matches a carbon monoxide sensor that carries no device class', () => {
    expect(suggest(AIR, 'sensor.indoor_co').config.sensors).toEqual({
      co: { entity: 'sensor.indoor_co' },
    });
  });

  it('does not confuse co2 with co', () => {
    const s = suggest(AIR, 'sensor.living_room_co2');
    expect(s.config.sensors).toEqual({ co2: { entity: 'sensor.living_room_co2' } });
  });
});

describe('what the air quality card does not claim', () => {
  it('does not claim a plain temperature reading', () => {
    const attrs = { device_class: 'temperature' };
    expect(suggest(AIR, 'sensor.bedroom', attrs)).toBeNull();
  });

  it('a plain humidity reading likewise', () => {
    const attrs = { device_class: 'humidity' };
    expect(suggest(AIR, 'sensor.bedroom', attrs)).toBeNull();
  });

  it('anything that is not a sensor or a number', () => {
    expect(suggest(AIR, 'light.office_co2')).toBeNull();
    expect(suggest(AIR, 'binary_sensor.office_co2')).toBeNull();
    expect(suggest(AIR, 'switch.co2_valve')).toBeNull();
  });

  it('an unknown entity, and a malformed argument', () => {
    const card = cards()[AIR];
    expect(card.getEntitySuggestion({ states: {} }, 'sensor.indoor_co').config.sensors).toEqual({
      co: { entity: 'sensor.indoor_co' },
    });
    expect(card.getEntitySuggestion(undefined, 'sensor.nothing_here')).toBeNull();
    expect(card.getEntitySuggestion({}, null)).toBeNull();
  });
});

describe('the suggested config is one the card can actually load', () => {
  it('round trips through setConfig without throwing', async () => {
    const s = suggest(AIR, 'sensor.indoor_co');
    const card = new AirQualityCard();
    expect(() => card.setConfig({ ...s.config, type: undefined })).not.toThrow();
  });
});
