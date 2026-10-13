import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import nextEnv from '@next/env';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const required = name => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is missing; run pnpm db:cloud:roles first`);
  return value;
};

const requiredAny = (...names) => {
  const value = names.map(name => process.env[name]?.trim()).find(Boolean);
  if (!value) throw new Error(`${names.join(' or ')} is missing`);
  return value;
};

async function setLocal(name,value) {
  for (const file of ['.env.local','.env.development.local']) {
    let source = await readFile(file,'utf8').catch(() => '');
    const line = `${name}=${value}`;
    const pattern = new RegExp(`^${name}=.*$`,'m');
    source = pattern.test(source) ? source.replace(pattern,line) : `${source.trimEnd()}\n${line}\n`;
    await writeFile(file,source,{ mode: 0o600 });
  }
}

function vercelEnv(name,target,value,sensitive) {
  return new Promise((resolve,reject) => {
    const child = spawn('npx',['vercel','env','add',name,target,'--force',sensitive ? '--sensitive' : '--no-sensitive','--yes'],{
      cwd: process.cwd(),env: process.env,stdio: ['pipe','pipe','pipe'],
    });
    let output = '',failure = '';
    child.stdout.on('data',chunk => { output += chunk; });
    child.stderr.on('data',chunk => { failure += chunk; });
    child.on('error',reject);
    child.on('close',code => code === 0 ? resolve(output.trim()) : reject(new Error(failure.trim() || `vercel env add ${name} failed`)));
    child.stdin.end(value+'\n');
  });
}

const developmentCookie = process.env.NEON_AUTH_COOKIE_SECRET?.trim() || randomBytes(48).toString('base64url');
await setLocal('NEON_AUTH_COOKIE_SECRET',developmentCookie);

const shared = [
  ['REPORTER_DEPLOYMENT_MODE','cloud',false],
  ['REPORTER_DEFAULT_PORTAL_ID','10000000-0000-0000-0000-000000000101',false],
  ['REPORTER_GENERATION_MODEL','openai/gpt-6-astra',false],
  ['GROQ_TRANSCRIPTION_MODEL',process.env.GROQ_TRANSCRIPTION_MODEL?.trim() || 'whisper-large-v3',false],
  ['REPORTER_RUNTIME_PASSWORD',required('REPORTER_RUNTIME_PASSWORD'),true],
  ['REPORTER_WORKER_PASSWORD',required('REPORTER_WORKER_PASSWORD'),true],
  ['GROQ_API_KEY',required('GROQ_API_KEY'),true],
  ['OPENAI_API_KEY',requiredAny('OPENAI_API_KEY','OPEN_AI_API_KEY'),true],
  ['ANTHROPIC_API_KEY',requiredAny('ANTHROPIC_API_KEY','CLAUDE_API_KEY'),true],
  ['PIXABAY_API_KEY',required('PIXABAY_API_KEY'),true],
];
for (const target of ['production','preview','development']) {
  for (const [name,value,sensitive] of shared) await vercelEnv(name,target,value,sensitive);
  const cookie = target === 'development' ? developmentCookie : randomBytes(48).toString('base64url');
  await vercelEnv('NEON_AUTH_COOKIE_SECRET',target,cookie,true);
  console.log(`Configured Reporter cloud environment for ${target}.`);
}
