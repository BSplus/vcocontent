import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSearchParams, serializeSearchParams, parseSearchPage, SEARCH_FIELDS } from '../client/src/lib/search-params.ts';

test('existing links keep all search fields enabled', () => {
  assert.deepEqual(parseSearchParams('?q=summer+party&type=video'), {
    query: 'summer party',
    filters: { mediaType: 'video', fields: [...SEARCH_FIELDS] },
  });
});

test('search links preserve every combination of selected fields', () => {
  for (let mask = 0; mask < 16; mask++) {
    const fields = SEARCH_FIELDS.filter((_, index) => mask & (1 << index));
    const encoded = serializeSearchParams('hello & world', { mediaType: 'image', fields });
    assert.deepEqual(parseSearchParams(`?${encoded}`), {
      query: 'hello & world',
      filters: { mediaType: 'image', fields },
    });
    assert.equal(encoded.includes('fields='), mask !== 15);
  }
});

test('page links accept positive safe integers only; serializing new conditions drops page', () => {
  assert.equal(parseSearchPage('?q=MAHLE&page=2'), 2);
  for (const page of ['', '0', '-1', '1.5', '2e3', '9007199254740992', 'abc']) {
    assert.equal(parseSearchPage(`?page=${page}`), 1);
  }
  const { query, filters } = parseSearchParams('?q=MAHLE&fields=caption&page=4');
  assert.equal(serializeSearchParams(query, filters), 'q=MAHLE&fields=caption');
});

test('unknown media types are ignored and an explicit empty field selection stays empty', () => {
  assert.deepEqual(parseSearchParams('?q=test&type=audio&fields='), {
    query: 'test',
    filters: { mediaType: 'all', fields: [] },
  });
});