import assert from 'node:assert/strict';
import {test} from 'node:test';
import {memberViewHref} from './member-view.ts';

test('copied member-view links preserve the context only inside the same client',()=>{
  const id='11111111-1111-4111-8111-111111111111';
  assert.equal(memberViewHref('client-one',id,'/productions/id/article?version=2#source'),`/w/client-one/productions/id/article?version=2&view=${id}#source`);
  assert.equal(memberViewHref('client-one',id,'/w/client-one/news'),`/w/client-one/news?view=${id}`);
  for(const href of ['/platform/people','/auth/sign-out','/workspaces','/w/client-two/','https://source.test/report'])assert.equal(memberViewHref('client-one',id,href),href);
  assert.equal(memberViewHref('client-one',undefined,'/news'),'/w/client-one/news');
  assert.equal(memberViewHref('client-one','!invalid','/news'),'/w/client-one/news?view=%21invalid','a malformed context cannot silently become ordinary administrator navigation');
});
