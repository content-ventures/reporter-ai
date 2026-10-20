import assert from 'node:assert/strict';
import { test } from 'node:test';
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
