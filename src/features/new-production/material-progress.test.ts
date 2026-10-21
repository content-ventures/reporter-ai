import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_MATERIAL_CHARS } from '../../domain/index.ts';
import { EMPTY_DRAFT } from './form.ts';
import { materialProgress } from './material-progress.ts';
import type { MaterialAnalysis } from './use-material-analysis.ts';

const idle: MaterialAnalysis = { status: 'idle',analysis: undefined,message: undefined };
const analyzing: MaterialAnalysis = { ...idle,status: 'analyzing' };
const audio = { ...EMPTY_DRAFT,mode: 'file' as const };

test('large uploads use actual transferred bytes, with no invented progress during preparation or transcription', () => {
  const read = { status: 'reading' as const,name: 'entrevista.mp3',size: 1024 ** 3,phase: 'uploading' as const,message: 'Enviando arquivo' };
  const unknown = materialProgress(audio,idle,read,null)!;
  assert.equal(unknown.upload,undefined);
  assert.equal(unknown.largeUpload,true);
  assert.equal(unknown.canCancel,true);
  const partial = materialProgress(audio,idle,{ ...read,uploadedBytes: 256 * 1024 ** 2,totalBytes: read.size },null)!;
  assert.equal(partial.upload?.percent,25);
  assert.deepEqual(partial.steps.map(step => step.state),['current','upcoming','upcoming']);
  const transcription = materialProgress(audio,idle,{ ...read,phase: 'transcribing',message: 'Transcrevendo áudio',done: 2,total: 6 },null)!;
  assert.equal(transcription.upload,undefined);
  assert.equal(transcription.canCancel,false);
  assert.deepEqual(transcription.steps.map(step => step.state),['done','current','upcoming']);
  assert.equal(transcription.steps[1].detail,'2 de 6 trechos concluídos');
});

test('text files and YouTube captions skip audio transcription and keep analysis distinct from reading', () => {
  const draft = { ...EMPTY_DRAFT,mode: 'file' as const,parts: [{ id: 'a',name: 'transcricao.txt',size: 250,text: 'Material' }] };
  const progress = materialProgress(draft,analyzing,null,null)!;
  assert.equal(progress.name,'transcricao.txt');
  assert.equal(progress.steps.length,2);
  assert.deepEqual(progress.steps.map(step => step.state),['done','current']);
  assert.equal(progress.upload,undefined);
  const link = materialProgress({ ...EMPTY_DRAFT,mode: 'link',sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },idle,null,
    { status: 'reading',name: 'url',phase: 'locating',message: 'Localizando episódio' })!;
  assert.equal(link.name,'Vídeo do YouTube');
  assert.equal(link.steps.length,2);
});

test('failures retain the failed phase and the appropriate retry; readiness completes every step', () => {
  const failure = materialProgress(audio,idle,{ status: 'error',name: 'entrevista.mp3',size: 2048,phase: 'transcribing',message: 'Limite temporário',retry: 'reread' },null)!;
  assert.equal(failure.status,'error');
  assert.equal(failure.retry,'file');
  assert.deepEqual(failure.steps.map(step => step.state),['done','error','upcoming']);
  assert.equal(failure.steps[1].detail,'Limite temporário');
  assert.equal(materialProgress(EMPTY_DRAFT,{ ...idle,status: 'error' },null,null)?.status,'error');
  const ready = materialProgress(EMPTY_DRAFT,{ ...idle,status: 'ready' },null,null)!;
  assert.ok(ready.steps.every(step => step.state === 'done'));
  assert.equal(ready.canCancel,false);
  assert.equal(materialProgress(EMPTY_DRAFT,idle,null,null),null);
});

const srt = (text: string) => `1\n00:00:00,000 --> 00:00:05,000\nAna: ${text}\n`;
const parted = (...parts: { id: string; text?: string; size?: number }[]) => ({ ...EMPTY_DRAFT,mode: 'file' as const,
  parts: parts.map(({ id,text,size }) => ({ id,name: `${id}.srt`,size: size ?? 100,...(text !== undefined ? { text } : {}) })) });

test('several parts: one step per part and the analysis waits for all', () => {
  const reading = { status: 'reading' as const,name: 'b.srt',size: 300,phase: 'reading' as const,message: 'Lendo arquivo' };
  const waiting = materialProgress(parted({ id: 'a',text: srt('um') },{ id: 'b',size: 300 }),idle,null,null,{ b: reading })!;
  assert.equal(waiting.name,'2 partes');
  assert.equal(waiting.size,400);
  assert.equal(waiting.phase,'parts');
  assert.equal(waiting.status,'running');
  assert.deepEqual(waiting.steps.map(step => [step.label,step.file,step.state]),
    [['Parte 1','a.srt','done'],['Parte 2','b.srt','current'],['Analisar material',undefined,'upcoming']]);
  assert.equal(waiting.steps[2].detail,undefined);
  assert.equal(waiting.upload,undefined);
  assert.deepEqual(waiting.parts?.map(part => part.status.kind),['ready','reading']);
  const draft = parted({ id: 'a',text: srt('um') },{ id: 'b',text: srt('dois') });
  const analyzing = materialProgress(draft,{ ...idle,status: 'analyzing' },null,null)!;
  assert.deepEqual(analyzing.steps.map(step => step.state),['done','done','current']);
  assert.equal(analyzing.steps[2].detail,'Identificando o tema e os participantes.');
  const analysis = { parts: [{ format: 'srt' as const,segments: 1,startMs: 0,durationMs: 5000 },{ format: 'srt' as const,segments: 1,startMs: 5000,durationMs: 5000 }] };
  const ready = materialProgress(draft,{ status: 'ready',analysis: analysis as MaterialAnalysis['analysis'],message: undefined },null,null)!;
  assert.equal(ready.status,'ready');
  assert.deepEqual(ready.steps.map(step => [step.state,step.meta]),[['done','00:05'],['done','00:05'],['done',undefined]]);
  const long = 'x'.repeat(MAX_MATERIAL_CHARS / 2);
  const tooLong = materialProgress(parted({ id: 'a',text: long },{ id: 'b',text: long }),idle,null,null)!;
  assert.equal(tooLong.status,'error');
  assert.equal(tooLong.retry,undefined);
  assert.equal(tooLong.steps[2].state,'error');
});

test('a failed part keeps the others running; retry is parts; cancel count', () => {
  const upload = (id: string) => ({ status: 'reading' as const,name: `${id}.mp3`,size: 6 * 1024 ** 2,phase: 'uploading' as const,message: 'Enviando arquivo' });
  const failed = { status: 'error' as const,name: 'c.mp3',size: 1,phase: 'uploading' as const,message: 'Conexão perdida.',retry: 'reread' as const };
  const draft = parted({ id: 'a' },{ id: 'b' },{ id: 'c' });
  const running = materialProgress(draft,idle,null,null,{ a: upload('a'),b: upload('b'),c: failed })!;
  assert.equal(running.status,'running');
  assert.equal(running.canCancel,true);
  assert.equal(running.cancelCount,2);
  assert.deepEqual(running.steps.map(step => step.state),['current','current','error','upcoming']);
  const settled = parted({ id: 'a',text: srt('um') },{ id: 'b' },{ id: 'c' });
  const stopped = materialProgress(settled,idle,null,null,{ c: failed,b: { ...failed,name: 'b.mp3',retry: 'pick' } })!;
  assert.equal(stopped.status,'error');
  assert.equal(stopped.retry,'parts');
  assert.equal(stopped.canCancel,false);
  assert.equal(materialProgress(settled,idle,null,null,{ b: { ...failed,retry: 'pick' },c: { ...failed,retry: 'pick' } })!.retry,'pick');
  assert.equal(materialProgress(parted({ id: 'a',text: srt('um') },{ id: 'b',text: srt('dois') }),{ ...idle,status: 'error',message: 'Falhou.' },null,null)!.retry,'analysis');
});
