import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Bid, LostItem, Organization } from './types';

// api.ts は import 時に auth.ts 経由で CognitoJwtVerifier.create() を実行し、
// USER_POOL_ID の形式を即座に検証する。本番環境では CDK が実値を注入するが、
// テスト実行時は未設定のため、require前にダミー値を設定しておく（require は同期実行なので
// トップレベルの静的importと違い、この代入より後に評価されることが保証される）。
process.env.USER_POOL_ID ??= 'ap-northeast-1_TESTPOOL01';
process.env.USER_POOL_CLIENT_ID ??= 'test-client-id';

const api: typeof import('./api') = require('./api');
const {
  compareBySort,
  finalizeSoldItem,
  generateBoxNumber,
  generateCaseNumber,
  hashString,
  parseBody,
  parseSearchQuery,
} = api;

const POLICE_ORG: Organization = {
  orgId: 'org-fukuoka-police',
  name: '福岡県警察',
  type: 'police',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const CORPORATE_ORG: Organization = {
  orgId: 'org-jr-hakata',
  name: 'JR博多シティ',
  type: 'corporate',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const makeItem = (overrides: Partial<LostItem> = {}): LostItem => ({
  itemId: 'i-test',
  title: 'テスト品',
  category: 'umbrella',
  description: 'テスト用の説明',
  foundLocation: '博多駅',
  foundMonth: '2026-04',
  pickupLocation: '博多区役所 1F 受取窓口',
  startPrice: 100,
  currentPrice: 500,
  bidCount: 2,
  status: 'active',
  endTime: '2026-04-01T00:00:00.000Z',
  conditionRank: 'good',
  quantity: 1,
  foundDate: '2026-03-01',
  caseNumber: '福岡県警察 遺失物第8-1234号',
  noticeDate: '2026-03-08',
  custodyEndDate: '2026-09-01',
  orgId: POLICE_ORG.orgId,
  orgName: POLICE_ORG.name,
  orgType: POLICE_ORG.type,
  ...overrides,
});

const makeBid = (overrides: Partial<Bid> = {}): Bid => ({
  itemId: 'i-test',
  bidId: 'b-1',
  bidderName: '入札者',
  bidderSub: 'sub-1',
  amount: 500,
  createdAt: '2026-03-15T00:00:00.000Z',
  ...overrides,
});

test('hashString は同じ入力なら常に同じ値を返す（決定的）', () => {
  assert.equal(hashString('i-001'), hashString('i-001'));
  assert.notEqual(hashString('i-001'), hashString('i-002'));
});

test('hashString は非負整数を返す', () => {
  assert.ok(Number.isInteger(hashString('any-value')));
  assert.ok(hashString('any-value') >= 0);
});

test('generateCaseNumber: 警察・自治体は「遺失物第X号」形式になる', () => {
  const caseNumber = generateCaseNumber(POLICE_ORG, 'i-001', '2026-04-12');
  assert.match(caseNumber, /^福岡県警察 遺失物第8-\d{4}号$/);
});

test('generateCaseNumber: 企業は「拾得物管理番号」形式になる', () => {
  const caseNumber = generateCaseNumber(CORPORATE_ORG, 'i-001', '2026-04-12');
  assert.match(caseNumber, /^JR博多シティ 拾得物管理番号 2026-\d{4}$/);
});

test('generateCaseNumber: 同じitemIdなら常に同じ整理番号になる', () => {
  const first = generateCaseNumber(POLICE_ORG, 'i-013', '2026-04-12');
  const second = generateCaseNumber(POLICE_ORG, 'i-013', '2026-04-12');
  assert.equal(first, second);
});

test('generateBoxNumber は1〜24の範囲で決定的な値を返す', () => {
  for (const itemId of ['i-001', 'i-002', 'i-013', 'i-014', 'abc123']) {
    const box = generateBoxNumber(itemId);
    assert.ok(box >= 1 && box <= 24, `box number ${box} out of range for ${itemId}`);
    assert.equal(box, generateBoxNumber(itemId));
  }
});

test('parseSearchQuery: パラメータなしはデフォルト値になる', () => {
  const query = parseSearchQuery(null);
  assert.deepEqual(query, {
    q: '',
    category: '',
    status: '',
    minPrice: null,
    maxPrice: null,
    sort: 'end_asc',
  });
});

test('parseSearchQuery: 有効なパラメータを取り込む', () => {
  const query = parseSearchQuery({
    q: '  博多駅 傘  ',
    category: 'umbrella',
    status: 'active',
    minPrice: '100',
    maxPrice: '5000',
    sort: 'price_desc',
  });
  assert.equal(query.q, '博多駅 傘');
  assert.equal(query.category, 'umbrella');
  assert.equal(query.status, 'active');
  assert.equal(query.minPrice, 100);
  assert.equal(query.maxPrice, 5000);
  assert.equal(query.sort, 'price_desc');
});

test('parseSearchQuery: 不正なsortはend_ascにフォールバックする', () => {
  const query = parseSearchQuery({ sort: 'not-a-sort-key' });
  assert.equal(query.sort, 'end_asc');
});

test('parseSearchQuery: 不正な価格は null になる', () => {
  const query = parseSearchQuery({ minPrice: 'abc', maxPrice: '-100' });
  assert.equal(query.minPrice, null);
  assert.equal(query.maxPrice, null);
});

test('compareBySort: price_asc は価格の昇順', () => {
  const a = makeItem({ currentPrice: 300 });
  const b = makeItem({ currentPrice: 100 });
  const sorted = [a, b].sort(compareBySort('price_asc'));
  assert.equal(sorted[0]?.currentPrice, 100);
});

test('compareBySort: price_desc は価格の降順', () => {
  const a = makeItem({ currentPrice: 300 });
  const b = makeItem({ currentPrice: 100 });
  const sorted = [a, b].sort(compareBySort('price_desc'));
  assert.equal(sorted[0]?.currentPrice, 300);
});

test('compareBySort: bids_desc は入札件数の降順', () => {
  const a = makeItem({ bidCount: 1 });
  const b = makeItem({ bidCount: 9 });
  const sorted = [a, b].sort(compareBySort('bids_desc'));
  assert.equal(sorted[0]?.bidCount, 9);
});

test('compareBySort: end_asc は終了時刻の昇順', () => {
  const a = makeItem({ endTime: '2026-05-01T00:00:00.000Z' });
  const b = makeItem({ endTime: '2026-04-01T00:00:00.000Z' });
  const sorted = [a, b].sort(compareBySort('end_asc'));
  assert.equal(sorted[0]?.endTime, '2026-04-01T00:00:00.000Z');
});

test('finalizeSoldItem: 現在価格と一致する入札を落札者にする', () => {
  const item = makeItem({ currentPrice: 800, status: 'active' });
  const bids = [
    makeBid({ bidId: 'b-1', bidderSub: 'sub-early', amount: 500 }),
    makeBid({ bidId: 'b-2', bidderSub: 'sub-winner', amount: 800 }),
  ];
  const updated = finalizeSoldItem(item, bids, new Date('2026-04-10T00:00:00.000Z'));
  assert.ok(updated !== null);
  assert.equal(updated?.status, 'sold');
  assert.equal(updated?.winnerSub, 'sub-winner');
  assert.equal(updated?.paymentStatus, 'unpaid');
  assert.equal(updated?.pickupStatus, 'awaiting');
  assert.equal(updated?.soldAt, '2026-04-10T00:00:00.000Z');
});

test('finalizeSoldItem: 一致する入札がなければ先頭の入札にフォールバックする', () => {
  const item = makeItem({ currentPrice: 999 });
  const bids = [makeBid({ bidId: 'b-1', bidderSub: 'sub-only', amount: 700 })];
  const updated = finalizeSoldItem(item, bids, new Date('2026-04-10T00:00:00.000Z'));
  assert.equal(updated?.winnerSub, 'sub-only');
});

test('finalizeSoldItem: 入札が1件もなければ null を返す', () => {
  const item = makeItem();
  const updated = finalizeSoldItem(item, [], new Date());
  assert.equal(updated, null);
});

test('finalizeSoldItem: 受取期限は基準時刻から14日後になる', () => {
  const item = makeItem();
  const bids = [makeBid()];
  const now = new Date('2026-04-10T00:00:00.000Z');
  const updated = finalizeSoldItem(item, bids, now);
  assert.equal(updated?.pickupDeadline, '2026-04-24T00:00:00.000Z');
});

test('parseBody: 正しいJSONオブジェクトをパースする', () => {
  const body = parseBody('{"amount": 1000}');
  assert.deepEqual(body, { amount: 1000 });
});

test('parseBody: 不正なJSONは null になる', () => {
  assert.equal(parseBody('{not-json'), null);
});

test('parseBody: bodyがnullなら null になる', () => {
  assert.equal(parseBody(null), null);
});
