import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ofOrganization, personLine } from './workspace.ts';

describe('who a person is in the text', () => {
  test('the role as written wins when it names the organisation', () => {
    assert.equal(personLine({ title: 'diretora de marketing da Casa Forma', organization: 'Casa Forma' }), 'diretora de marketing da Casa Forma');
    assert.equal(personLine({ title: 'diretora de marketing', organization: 'Casa Forma' }), 'diretora de marketing da Casa Forma');
    assert.equal(personLine({ title: 'gerente de operações', organization: 'Grupo Horizonte' }), 'gerente de operações do Grupo Horizonte');
    assert.equal(personLine({ organization: 'Couro Nobre' }), 'Couro Nobre');
    assert.equal(personLine({}), undefined);
  });

  test('picks "do" for masculine heads and acronyms, "da" otherwise', () => {
    assert.equal(ofOrganization('Ateliê Sul'), 'do Ateliê Sul');
    assert.equal(ofOrganization('Pátio Couro'), 'do Pátio Couro');
    assert.equal(ofOrganization('IBGE'), 'do IBGE');
    assert.equal(ofOrganization('Aurora Calçados'), 'da Aurora Calçados');
  });
});
