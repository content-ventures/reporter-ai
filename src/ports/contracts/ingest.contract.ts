import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IngestFile } from '../source-ingest.ts';
import { CONTRACT_TRANSCRIPT, unwrap, withPorts } from './fixture.ts';
import type { PortsFactory } from './fixture.ts';

/** SourceIngest contract: what Nova produção shows before anything is saved. */

function file(name: string, text: string, size = text.length): IngestFile {
  return { name, size, text: async () => text };
}

const SRT = ['1', '00:00:01,000 --> 00:00:04,000', 'Helena Duarte: A torrefação mudou a nossa margem.', '', '2', '00:00:05,000 --> 00:00:09,500', 'Helena Duarte: Antes a gente vendia o grão cru.', ''].join('\n');

const VTT = ['WEBVTT', '', '00:00:01.000 --> 00:00:03.000', '<v Repórter>Como nasceu a cooperativa?', '', '00:00:03.500 --> 00:00:08.000', '<v Helena Duarte>Nasceu em 2019, com doze famílias.', ''].join('\n');

export function ingestPortContract(name: string, make: PortsFactory): void {
  describe(`${name} · source ingest contract`, () => {
    it('analyses "Nome: fala" material: speakers, words, hash and a preview', () =>
      withPorts(make, async (ports) => {
        const analysis = unwrap(await ports.ingest.analyze(CONTRACT_TRANSCRIPT));
        assert.equal(analysis.format, 'speaker-lines');
        assert.deepEqual(analysis.speakers.map((speaker) => speaker.label), ['Repórter', 'Helena Duarte']);
        assert.ok(analysis.stats.words > 50);
        assert.equal(analysis.stats.hasTimestamps, false);
        assert.ok(analysis.preview.length > 0 && analysis.preview.length <= analysis.segments.length);
        assert.equal(analysis.short, analysis.stats.words < ports.ingest.limits.shortWords);
        const again = unwrap(await ports.ingest.analyze(`${CONTRACT_TRANSCRIPT}\n`));
        assert.equal(again.hash, analysis.hash, 'trailing whitespace does not change the material');
      }));

    it('keeps timestamps from .srt and .vtt files', () =>
      withPorts(make, async (ports) => {
        const srt = unwrap(await ports.ingest.analyze(SRT, { fileName: 'entrevista.srt' }));
        assert.equal(srt.format, 'srt');
        assert.equal(srt.stats.hasTimestamps, true);
        assert.equal(srt.segments[0].startMs, 1000);
        const vttFile = unwrap(await ports.ingest.read(file('entrevista.vtt', VTT)));
        assert.equal(vttFile.format, 'vtt');
        const vtt = unwrap(await ports.ingest.analyze(vttFile.text, { fileName: vttFile.fileName }));
        assert.equal(vtt.stats.hasTimestamps, true);
        assert.ok(vtt.speakers.some((speaker) => speaker.label === 'Helena Duarte'));
      }));

    it('refuses unsupported, oversized, empty and unreadable files', () =>
      withPorts(make, async (ports) => {
        const cases: [IngestFile, string][] = [
          [file('pauta.pdf', 'x'), 'unsupported_type'],
          [file('enorme.txt', 'x', ports.ingest.limits.maxBytes + 1), 'too_large'],
          [file('vazio.md', '   \n'), 'empty'],
          [{ name: 'quebrado.txt', size: 10, text: () => Promise.reject(new Error('io')) }, 'read_failed'],
        ];
        for (const [input, code] of cases) {
          const result = await ports.ingest.read(input);
          assert.equal(result.ok, false, input.name);
          if (!result.ok) assert.equal(result.refusal.code, code);
        }
        const empty = await ports.ingest.analyze('  ');
        assert.equal(empty.ok, false);
      }));
  });
}
