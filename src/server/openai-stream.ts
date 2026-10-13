import 'server-only';
import { FlowError } from './errors';

/** Responses SSE is transport data: never surface reasoning, envelopes or provider messages. */
export async function readOpenAIStream(response: Response, signal: AbortSignal, onText: (text: string) => Promise<void>): Promise<unknown> {
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new FlowError('OPENAI_INVALID_STREAM',502,true,5);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort',abort,{ once: true });
  let buffer = '', size = 0, text = '', channel: string | undefined;
  try {
    for (;;) {
      if (signal.aborted) throw new FlowError('JOB_INTERRUPTED',503,true,5);
      const part = await reader.read();
      if (signal.aborted) throw new FlowError('JOB_INTERRUPTED',503,true,5);
      if (part.done) break;
      size += part.value.length;
      if (size > 4 * 1024 ** 2) throw new FlowError('PROVIDER_RESPONSE_TOO_LARGE',502);
      buffer += decoder.decode(part.value,{ stream: true });
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0,match.index); buffer = buffer.slice(match.index+match[0].length);
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data || data === '[DONE]') continue;
        let event: Record<string,unknown>;
        try { event = JSON.parse(data); } catch { throw new FlowError('OPENAI_INVALID_STREAM',502,true,5); }
        if (!event || typeof event !== 'object') throw new FlowError('OPENAI_INVALID_STREAM',502,true,5);
        if (event.type === 'response.refusal.delta' || event.type === 'response.refusal.done') throw new FlowError('GENERATION_REFUSED',502);
        if (event.type === 'error' || event.type === 'response.failed') throw new FlowError('OPENAI_STREAM_FAILED',502,true,5);
        if (event.type === 'response.incomplete') throw new FlowError('GENERATION_INCOMPLETE',502,true,5);
        if (event.type === 'response.output_text.delta') {
          if (typeof event.delta !== 'string') throw new FlowError('OPENAI_INVALID_STREAM',502,true,5);
          const key = JSON.stringify([event.item_id,event.output_index,event.content_index]);
          if (channel && channel !== key) throw new FlowError('OPENAI_INVALID_STREAM',502,true,5);
          channel = key; text += event.delta;
          await onText(text);
        }
        if (event.type === 'response.completed') {
          const completed = event.response as { output?: { type?: string; content?: { type?: string; text?: string }[] }[] } | undefined;
          if (!completed || !Array.isArray(completed.output)) throw new FlowError('OPENAI_INVALID_STREAM',502,true,5);
          const final = completed.output.flatMap(item => item.type === 'message' ? item.content ?? [] : []).filter(part => part.type === 'output_text').map(part => part.text ?? '').join('');
          if (!text || text !== final) throw new FlowError('OPENAI_INVALID_STREAM',502,true,5);
          return completed;
        }
      }
      if (buffer.length > 1024 ** 2) throw new FlowError('PROVIDER_RESPONSE_TOO_LARGE',502);
    }
    throw new FlowError('GENERATION_INCOMPLETE',502,true,5);
  } finally { signal.removeEventListener('abort',abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
