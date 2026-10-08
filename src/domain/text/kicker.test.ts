import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { articleTopic, coverKicker, mainOrganization } from './kicker.ts';

describe('cover kicker · "editoria · marca"', () => {
  test('the editoria comes from the words of the article, the title counting more', () => {
    const text = 'A exportação responde por 31% do faturamento. A marca está em 64 lojas europeias, e o mercado externo cresce.';
    assert.equal(articleTopic({ title: 'Bijuteria brasileira na Europa', text }), 'Exportação');
    assert.equal(
      articleTopic({ title: 'Aparas de couro viram produto', text: 'O curtume reaproveita as aparas e reduz o descarte. A reciclagem virou linha.' }),
      'Sustentabilidade',
    );
  });

  test('a trends interview reads "Tendências"; "fábrica", the whole trade\'s word, names no subject', () => {
    const text = 'A fábrica muda a forma. Na fábrica, a tira fina; a fábrica corta custo e a fábrica repõe na estação.';
    assert.equal(articleTopic({ title: '“O lojista aprendeu” · Tendências do verão 2027', text }), 'Tendências');
    assert.equal(articleTopic({ text: 'A fábrica, a fábrica, a fábrica e a fábrica.' }), undefined);
  });

  test('no section stands out → no editoria (one stray word is not a subject)', () => {
    assert.equal(articleTopic({ text: 'Começou em 2018 na cozinha da mãe, com um forno pequeno e doze vizinhos.' }), undefined);
    assert.equal(articleTopic({ text: 'Uma loja abriu.' }), undefined);
  });

  test('matches word starts only ("loja" is not inside "aloja")', () => {
    assert.equal(articleTopic({ text: 'aloja aloja aloja aloja' }), undefined);
  });

  test('the brand is the organisation that speaks the most', () => {
    assert.equal(
      mainOrganization([
        { organization: 'Lume Acessórios', weight: 12 },
        { weight: 9 },
        { organization: 'Consultoria Rezende', weight: 4 },
        { organization: ' Lume Acessórios ', weight: 2 },
      ]),
      'Lume Acessórios',
    );
    assert.equal(mainOrganization([{ weight: 3 }, { organization: '  ', weight: 5 }]), undefined);
  });

  test('both parts when they fit, then the brand, the editoria and the origin', () => {
    assert.equal(coverKicker({ topic: 'Exportação', brand: 'Lume Acessórios', fallback: 'Entrevista' }, 32), 'Exportação · Lume Acessórios');
    assert.equal(coverKicker({ topic: 'Sustentabilidade', brand: 'Cooperativa Fermento Vivo', fallback: 'Entrevista' }, 32), 'Cooperativa Fermento Vivo');
    assert.equal(coverKicker({ topic: 'Produto', fallback: 'Entrevista' }, 32), 'Produto');
    assert.equal(coverKicker({ fallback: 'Entrevista' }, 32), 'Entrevista');
    assert.equal(coverKicker({}, 32), undefined);
  });
});
