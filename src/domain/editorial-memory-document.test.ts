import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_TEXT_BYTES } from './reporter.ts';
import { readMemoryDocument } from './editorial-memory-document.ts';

const bytes = (text: string) => new TextEncoder().encode(text);

test('text originals retain BOM, exact Unicode, whitespace, line endings and recoverable locations', () => {
  const text = '\ufeff  Cafe\u0301 😀\r\n\r\nTerceira linha\rQuarta\nFim  ';
  for (const extension of ['TXT', 'md', 'srt', 'vtt']) {
    const original = bytes(text), result = readMemoryDocument({ name: `Documento sem data.${extension}`, bytes: original });
    assert.ok(result.ok); assert.equal(result.value.text, text); assert.deepEqual(bytes(result.value.text), original);
    assert.equal(result.value.bytes, original.length); assert.equal(result.value.delimiter, null);
    assert.equal(result.value.locations.map(location => text.slice(location.from, location.to)).join(''), text);
    assert.deepEqual(result.value.locations.map(location => [location.ordinal, location.firstLine, location.lastLine]), [[0, 1, 1], [1, 2, 2], [2, 3, 3], [3, 4, 4], [4, 5, 5]]);
  }
});

test('semicolon market tables preserve raw decimal/date/formula values and exact multiline record locations', () => {
  const text = '\ufeffinstituicao;indicador;valor;periodo;evidencia\r\n"Órgão teste";"Receita ""bruta""";"1.234,56";;"  primeira\r\nsegunda 😀  "\r\nOutro;Sem publicação;=1+2;2020;última linha\r\n';
  const result = readMemoryDocument({ name: 'mercado.csv', bytes: bytes(text), delimiter: ';' });
  assert.ok(result.ok); const document = result.value;
  assert.equal(document.text, text); assert.equal(document.locations.length, 3);
  assert.equal(document.locations.map(row => text.slice(row.from, row.to)).join(''), text);
  assert.deepEqual(document.locations[1].cells!.map(cell => cell.value), ['Órgão teste', 'Receita "bruta"', '1.234,56', '', '  primeira\r\nsegunda 😀  ']);
  assert.deepEqual(document.locations.map(row => [row.firstLine, row.lastLine]), [[1, 1], [2, 3], [4, 4]]);
  assert.equal(document.locations[2].cells![2].value, '=1+2');
  assert.equal(text.slice(document.locations[1].cells![2].from, document.locations[1].cells![2].to), '"1.234,56"');
  assert.equal(document.locations[0].cells![0].value, 'instituicao');
});

test('CSV defaults to commas, TSV uses tabs and trailing empty cells remain observations', () => {
  for (const [name, separator] of [['dados.csv', ','], ['dados.tsv', '\t']] as const) {
    for (const ending of ['', '\n', '\r\n']) {
      const text = `campo${separator}valor${separator}data\n"a${separator}b"${separator}0${separator}${ending}`;
      const result = readMemoryDocument({ name, bytes: bytes(text) }); assert.ok(result.ok);
      assert.equal(result.value.locations.length, 2);
      assert.deepEqual(result.value.locations[1].cells!.map(cell => cell.value), [`a${separator}b`, '0', '']);
      assert.equal(result.value.locations.map(row => text.slice(row.from, row.to)).join(''), text);
    }
  }
});

test('invalid quoting and ragged records refuse the complete table with an actionable physical line', () => {
  for (const text of ['a,b\n"unclosed,b', 'a,b\nx"y,z', 'a,b\n"x"suffix,z', 'a,b\nx,y,z', 'a,b\nx']) {
    const result = readMemoryDocument({ name: 'dados.csv', bytes: bytes(text) });
    assert.equal(result.ok, false); if (!result.ok) { assert.equal(result.refusal.code, 'invalid_document'); assert.equal(result.refusal.details?.line, 2); }
  }
});

test('binary, invalid UTF-8, empty and unsupported files cannot masquerade as readable originals', () => {
  const examples = [
    { name: 'arquivo.txt', bytes: new Uint8Array([0xc3, 0x28]), code: 'invalid_encoding' },
    { name: 'arquivo.txt', bytes: bytes('Texto com \0 dados'), code: 'invalid_document' },
    { name: 'arquivo.txt', bytes: bytes('   \r\n\ufeff'), code: 'empty' },
    { name: '../arquivo.txt', bytes: bytes('texto'), code: 'invalid_document' },
    { name: 'arquivo.pdf', bytes: bytes('%PDF-1.7'), code: 'unsupported_type' },
    { name: 'arquivo.docx', bytes: bytes('PK'), code: 'unsupported_type' },
    { name: 'arquivo.constructor', bytes: bytes('texto'), code: 'unsupported_type' },
    { name: 'sem-extensao', bytes: bytes('texto'), code: 'unsupported_type' },
  ];
  for (const example of examples) {
    const result = readMemoryDocument(example); assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.refusal.code, example.code);
  }
});

test('bounded bytes/records/columns and explicit dialect validation prevent partial or unbounded imports', () => {
  const exact = readMemoryDocument({ name: 'max.txt', bytes: bytes('a'.repeat(MAX_TEXT_BYTES)) }); assert.ok(exact.ok);
  const oversized = readMemoryDocument({ name: 'max.txt', bytes: bytes('a'.repeat(MAX_TEXT_BYTES + 1)) });
  assert.equal(oversized.ok, false); if (!oversized.ok) assert.equal(oversized.refusal.code, 'too_large');
  for (const name of ['linhas.txt', 'linhas.csv']) {
    const exactRows = readMemoryDocument({ name, bytes: bytes('a\n'.repeat(10_000)) }); assert.ok(exactRows.ok);
    const excessRows = readMemoryDocument({ name, bytes: bytes('a\n'.repeat(10_001)) }); assert.equal(excessRows.ok, false);
    if (!excessRows.ok) assert.equal(excessRows.refusal.code, 'document_limit');
  }
  for (const suffix of ['', ',']) {
    const columns = readMemoryDocument({ name: 'colunas.csv', bytes: bytes(Array.from({ length: suffix ? 128 : 129 }, () => 'a').join(',') + suffix) });
    assert.equal(columns.ok, false); if (!columns.ok) assert.equal(columns.refusal.code, 'document_limit');
  }
  for (const name of ['texto.txt', 'dados.tsv']) {
    assert.equal(readMemoryDocument({ name, bytes: bytes('a,b'), delimiter: ';' }).ok, false);
  }
});
