import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function releaseEnvironment(environment) {
  const values = { ...environment,
    OPENAI_API_KEY: environment.OPENAI_API_KEY?.trim() || environment.OPEN_AI_API_KEY?.trim(),
    ANTHROPIC_API_KEY: environment.ANTHROPIC_API_KEY?.trim() || environment.CLAUDE_API_KEY?.trim(),
    GEMINI_API_KEY: environment.GEMINI_API_KEY?.trim() || environment.GOOGLE_API_KEY?.trim(),
  };
  const required = ['NEON_API_KEY', 'NEON_PROJECT_ID', 'NEON_BRANCH_ID', 'REPORTER_WORKER_PASSWORD',
    'GROQ_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'PIXABAY_API_KEY'];
  const missing = required.filter(name => !values[name]?.trim());
  if (missing.length) throw new Error(`Missing production release configuration: ${missing.join(', ')}.`);
  return values;
}

export async function checkProviders(environment, request = fetch) {
  const geminiKey = environment.GEMINI_API_KEY?.trim() || environment.GOOGLE_API_KEY?.trim();
  const checks = [
    ['Groq', 'https://api.groq.com/openai/v1/models', { Authorization: `Bearer ${environment.GROQ_API_KEY}` }],
    ['OpenAI', 'https://api.openai.com/v1/models', { Authorization: `Bearer ${environment.OPENAI_API_KEY}` }],
    ['Anthropic', 'https://api.anthropic.com/v1/models?limit=1', {
      'x-api-key': environment.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01',
    }],
    ['Pixabay', `https://pixabay.com/api/?key=${encodeURIComponent(environment.PIXABAY_API_KEY)}&q=seafood&per_page=3`, {}],
    // Optional direct Gemini credential check: model metadata only, no generation.
    ...(geminiKey ? [['Gemini', 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { 'x-goog-api-key': geminiKey }]] : []),
    // Optional (fact check). The usage endpoint authenticates the key without running a search.
    ...(environment.TAVILY_API_KEY?.trim() ? [['Tavily', 'https://api.tavily.com/usage', { Authorization: `Bearer ${environment.TAVILY_API_KEY}` }]] : []),
  ];
  await Promise.all(checks.map(async ([name, url, headers]) => {
    let response;
    try { response = await request(url, { headers, signal: AbortSignal.timeout(30_000) }); }
    catch { throw new Error(`${name} credential check could not reach its API.`); }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`${name} credential check failed (HTTP ${response.status}).`); }
    // Do not print API responses, request URLs or any credential.
    await response.body?.cancel();
    console.log(`${name}: API credentials accepted.`);
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await checkProviders(releaseEnvironment(process.env)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
