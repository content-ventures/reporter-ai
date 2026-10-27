import assert from 'node:assert/strict';
import {test} from 'node:test';
import {memberViewHref,memberViewImageSource} from './member-view.ts';

test('copied member-view links preserve the context only inside the same client',()=>{
  const id='11111111-1111-4111-8111-111111111111';
  assert.equal(memberViewHref('client-one',id,'/productions/id/article?version=2#source'),`/w/client-one/productions/id/article?version=2&view=${id}#source`);
  assert.equal(memberViewHref('client-one',id,'/w/client-one/news'),`/w/client-one/news?view=${id}`);
  for(const href of ['/platform/people','/auth/sign-out','/workspaces','/w/client-two/','https://source.test/report'])assert.equal(memberViewHref('client-one',id,href),href);
  assert.equal(memberViewHref('client-one',undefined,'/news'),'/w/client-one/news');
  assert.equal(memberViewHref('client-one','!invalid','/news'),'/w/client-one/news?view=%21invalid','a malformed context cannot silently become ordinary administrator navigation');
});

test('viewed private photos cannot reuse an administrator URL or another environment cache',()=>{
  const id='11111111-1111-4111-8111-111111111111',path='/api/reporter/avatars/person/workspace/photo.image';
  assert.equal(memberViewImageSource(id,path),`${path}?_view=${id}`);
  assert.equal(memberViewImageSource(id,`https://another-app.test${path}`),`${path}?_view=${id}`);
  assert.equal(memberViewImageSource(id,`${path}?_view=old`),`${path}?_view=${id}`);
  assert.equal(memberViewImageSource(id,'https://public-photo.test/photo.webp'),'https://public-photo.test/photo.webp');
});
