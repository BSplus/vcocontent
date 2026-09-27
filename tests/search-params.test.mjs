import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSearchParams, serializeSearchParams } from '../client/src/lib/search-params.ts';

test('existing links keep all search fields enabled', () => {
  assert.deepEqual(parseSearchParams('?q=summer+party&type=video'), {
    query: 'summer party',
    filters: { mediaType: 'video', fields: ['caption', 'photographer', 'tags'] },
  });
});

test('search links preserve every combination of selected fields', () => {
  for (let mask = 0; mask < 8; mask++) {
    const fields = ['caption', 'photographer', 'tags'].filter((_, index) => mask & (1 << index));
    const encoded = serializeSearchParams('hello & world', { mediaType: 'image', fields });
    assert.deepEqual(parseSearchParams(`?${encoded}`), {
      query: 'hello & world',
      filters: { mediaType: 'image', fields },
    });
    assert.equal(encoded.includes('fields='), mask !== 7);
  }
});

test('unknown media types are ignored and an explicit empty field selection stays empty', () => {
  assert.deepEqual(parseSearchParams('?q=test&type=audio&fields='), {
    query: 'test',
    filters: { mediaType: 'all', fields: [] },
  });
});