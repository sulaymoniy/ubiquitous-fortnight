import * as shared from '@fortnight/shared';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  AGENT_SSE_FIXTURES,
  FIXTURES,
  INLINE_SSE_FIXTURES,
  INVALID,
  TOOL_INPUT_FIXTURES,
} from './fixtures.ts';

/** Every exported Zod schema of @fortnight/shared, by export name. */
const exportedSchemas = Object.entries(shared as Record<string, unknown>).filter(
  (entry): entry is [string, z.ZodType] => entry[1] instanceof z.ZodType,
);

/** JSON round trip: what a client sends or receives over HTTP. */
const viaJson = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

describe('contract v1 schemas', () => {
  it('exports CONTRACT_VERSION 1.0.0', () => {
    expect(shared.CONTRACT_VERSION).toBe('1.0.0');
  });

  it('has a fixture for every exported schema', () => {
    const missing = exportedSchemas.filter(([, schema]) => !FIXTURES.has(schema)).map(([n]) => n);
    expect(missing).toEqual([]);
    expect(exportedSchemas.length).toBeGreaterThan(100);
  });

  describe.each(exportedSchemas)('%s', (_name, schema) => {
    it('parses its fixtures after a JSON round trip, and its output is stable', () => {
      const fixtures = FIXTURES.get(schema) ?? [];
      for (const f of fixtures) {
        const out = schema.parse(viaJson(f.input));
        expect(out).toEqual(f.output ?? f.input);
        // Schemas without input transforms must also accept their own output.
        if (f.output === undefined) expect(schema.parse(viaJson(out))).toEqual(out);
      }
    });
  });

  describe.each(INVALID)('rejects %s', (_label, schema, value) => {
    it('fails to parse', () => {
      expect(schema.safeParse(viaJson(value)).success).toBe(false);
    });
  });

  it.each(Object.keys(shared.AGENT_SSE_EVENTS) as shared.AgentSseEventName[])(
    'SSE event %s round-trips',
    (name) => {
      const value = AGENT_SSE_FIXTURES[name];
      expect(shared.AGENT_SSE_EVENTS[name].parse(viaJson(value))).toEqual(value);
    },
  );

  it.each(Object.keys(shared.INLINE_SSE_EVENTS) as shared.InlineSseEventName[])(
    'inline SSE event %s round-trips',
    (name) => {
      const value = INLINE_SSE_FIXTURES[name];
      expect(shared.INLINE_SSE_EVENTS[name].parse(viaJson(value))).toEqual(value);
    },
  );

  it.each([...shared.AGENT_TOOL_NAMES])('tool input %s round-trips', (name) => {
    const value = TOOL_INPUT_FIXTURES[name];
    expect(shared.AGENT_TOOL_INPUTS[name].parse(viaJson(value))).toEqual(value);
  });

  it('lists only real tools as mutating', () => {
    for (const t of shared.MUTATING_AGENT_TOOLS) expect(shared.AGENT_TOOL_NAMES).toContain(t);
    expect(shared.MUTATING_AGENT_TOOLS).not.toContain('get_page');
  });

  it('keeps every block type and property type covered by its union', () => {
    for (const type of shared.BLOCK_TYPES) {
      expect(shared.BlockTypeContent.options.some((o) => o.shape.type.value === type)).toBe(true);
    }
    for (const type of shared.PROPERTY_TYPES) {
      expect(shared.Property.options.some((o) => o.shape.type.value === type)).toBe(true);
    }
  });
});
