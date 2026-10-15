/**
 * Loopback stand-ins for the AI providers in the cloud rehearsal. Every other HTTPS request
 * fails loudly, so the rehearsal can never reach a real provider, Neon or storage.
 */
type JsonSchema = { type?: string; enum?: unknown[]; properties?: Record<string, JsonSchema>; required?: string[];
  items?: JsonSchema; minItems?: number; maxItems?: number; minLength?: number; pattern?: string };

/** The smallest instance of a strict JSON schema; enum values rotate so ids are not repeated. */
export function sampleJson(schema: JsonSchema, rotation = new Map<string, number>()): unknown {
  if (schema.enum?.length) {
    const key = JSON.stringify(schema.enum), next = rotation.get(key) ?? 0;
    rotation.set(key, next + 1);
    return schema.enum[next % schema.enum.length];
  }
  if (schema.type === 'object') {
    return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([name, property]) => [name, sampleJson(property, rotation)]));
  }
  if (schema.type === 'array') {
    const count = Math.max(schema.minItems ?? 0, Math.min(1, schema.maxItems ?? 1));
    return Array.from({ length: count }, () => sampleJson(schema.items ?? {}, rotation));
  }
  if (schema.type === 'integer' || schema.type === 'number') return 1;
  if (schema.type === 'boolean') return false;
  return 'Texto sintético do ensaio.'.padEnd(Math.max(schema.minLength ?? 0, 0), '.');
}

export function installFakeProviders(options: { failTranscriptionCalls?: number[] } = {}) {
  const original = globalThis.fetch;
  const calls = { transcriptions: 0, completions: 0 };
  // Quote curation must keep the outline's evidence: answer it from the last outline returned.
  let outline: { introIds: string[]; sections: { evidenceIds: string[] }[] } | undefined;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://api.groq.com/openai/v1/audio/transcriptions') {
      const call = calls.transcriptions++;
      if (options.failTranscriptionCalls?.includes(call)) return Response.json({ error: { code: 'server_error' } }, { status: 500 });
      return Response.json({ text: `Trecho ${call} do ensaio.`, duration: 600,
        segments: [{ start: 1, end: 9, text: `Trecho ${call} do ensaio.` }] }, { headers: { 'x-request-id': `fake-transcription-${call}` } });
    }
    if (url === 'https://api.groq.com/openai/v1/chat/completions') {
      calls.completions++;
      const schema = JSON.parse(String(init?.body)).response_format?.json_schema?.schema as JsonSchema;
      let value = sampleJson(schema) as Record<string, unknown>;
      if (schema.properties?.sections && schema.properties?.introIds) outline = value as typeof outline;
      if (schema.properties?.sectionIds && outline) value = { introIds: outline.introIds, sectionIds: outline.sections.map(section => section.evidenceIds) };
      return Response.json({ id: `fake-completion-${calls.completions}`, usage: { prompt_tokens: 10, completion_tokens: 10 },
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] });
    }
    if (/^https:/i.test(url)) throw new Error(`The rehearsal refused an external request to ${new URL(url).host}`);
    return original(input, init);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}
