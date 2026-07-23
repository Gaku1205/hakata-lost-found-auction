import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isConditionRank, isItemCategory, isOrgType, isSortKey } from './types';

test('isConditionRank: 定義済みの値のみtrue', () => {
  assert.equal(isConditionRank('like_new'), true);
  assert.equal(isConditionRank('good'), true);
  assert.equal(isConditionRank('used'), true);
  assert.equal(isConditionRank('damaged'), true);
  assert.equal(isConditionRank('unknown'), false);
  assert.equal(isConditionRank(123), false);
  assert.equal(isConditionRank(undefined), false);
});

test('isOrgType: 定義済みの値のみtrue', () => {
  assert.equal(isOrgType('police'), true);
  assert.equal(isOrgType('corporate'), true);
  assert.equal(isOrgType('individual'), false);
  assert.equal(isOrgType(null), false);
});

test('isSortKey: 定義済みの値のみtrue', () => {
  assert.equal(isSortKey('end_asc'), true);
  assert.equal(isSortKey('price_asc'), true);
  assert.equal(isSortKey('price_desc'), true);
  assert.equal(isSortKey('bids_desc'), true);
  assert.equal(isSortKey('price_asc_desc'), false);
  assert.equal(isSortKey(''), false);
});

test('isItemCategory: 定義済みの値のみtrue', () => {
  assert.equal(isItemCategory('umbrella'), true);
  assert.equal(isItemCategory('wallet'), true);
  assert.equal(isItemCategory('book'), true);
  assert.equal(isItemCategory('toy'), false);
  assert.equal(isItemCategory(42), false);
});
