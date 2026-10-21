import 'server-only';
import { z } from 'zod';
import { FlowError } from './errors';

/** Direct Google Interactions transport. Verified against the official API on 2026-10-21:
 * https://ai.google.dev/api/interactions-api
 * https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
 * https://ai.google.dev/gemini-api/docs/models/gemini-4-argon */
export const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

/** Keep unsupported grammar constraints as instructions; the domain validates the original
 * contract before saving. Do not remove property names that happen to match schema keywords.
 * https://ai.google.dev/gemini-api/docs/structured-output */
export function geminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const removed = new Set(['minLength', 'maxLength', 'minProperties', 'maxProperties', 'pattern', 'multipleOf']);
  const result: Record<string, unknown> = {}, constraints: string[] = [];
  for (const [key, value] of Object.entries(schema)) {
    if (removed.has(key)) constraints.push(key + '=' + value);
    else if (['properties', '$defs', 'definitions'].includes(key) && value && typeof value === 'object')
      result[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, geminiSchema(child)]));
    else result[key] = geminiSchema(value);
  }
  if (constraints.length) result.description = [result.description, 'Limits: ' + constraints.join(', ')].filter(Boolean).join('. ');
  return result;
}

export function geminiRequest(model: string, systemPrompt: string, userPrompt: string, maxTokens: number, schema: object) {
  return {
    model, store: false, system_instruction: systemPrompt, input: userPrompt,
    // Current Gemini models ignore temperature; never imply it changes generation.
    generation_config: { max_output_tokens: maxTokens, thinking_level: 'low', thinking_summaries: 'none' },
    response_format: { type: 'text', mime_type: 'application/json', schema: geminiSchema(schema) },
  };
}

const tokenCount = z.number().int().nonnegative();
const responseSchema = z.object({
  id: z.string().optional(), status: z.string(),
  steps: z.array(z.object({ type: z.string(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional() })).optional(),
  errors: z.array(z.object({ code: z.string().optional() })).optional(),
  usage: z.object({ total_input_tokens: tokenCount.optional(), total_output_tokens: tokenCount.optional(), total_thought_tokens: tokenCount.optional() }).optional(),
});

export function readGeminiResult(data: unknown) {
  const parsed = responseSchema.safeParse(data);
  if (!parsed.success) throw new FlowError('GEMINI_INVALID_RESPONSE', 502, true, 5);
  const response = parsed.data;
  // Fail closed on provider errors and refusals, without exposing diagnostic text.
  if (response.status === 'failed' || response.errors?.length) throw new FlowError('GEMINI_REQUEST_FAILED', 502);
  if (response.status === 'cancelled') throw new FlowError('JOB_INTERRUPTED', 503, true, 5);
  if (response.status !== 'completed') throw new FlowError('GENERATION_INCOMPLETE', 502, true, 5);
  const content = (response.steps ?? []).filter(step => step.type === 'model_output')
    .flatMap(step => step.content ?? []).filter(part => part.type === 'text').map(part => part.text ?? '').join('');
  return {
    content, responseId: response.id, inputTokens: response.usage?.total_input_tokens ?? null,
    // Google reports thinking separately; include it in consumed output tokens like OpenAI.
    outputTokens: response.usage?.total_output_tokens == null ? null : response.usage.total_output_tokens + (response.usage.total_thought_tokens ?? 0),
  };
}
