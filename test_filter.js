// test_filter.js - Unit tests for filter engine
import { evaluateAd, calculateBenchmarkPrice, checkDescriptionBlacklist, DEFAULT_STOP_WORDS } from './background/filter-engine.js';

console.log('--- Testing checkDescriptionBlacklist ---');

// Case 1: Commission stop-word
const test1 = checkDescriptionBlacklist('Привет, перевод с тинькофф, комиссия 200р с покупателя', DEFAULT_STOP_WORDS, 1400);
console.assert(test1.blocked === true, 'Failed: should block "комиссия"');
console.log('Test 1 (комиссия):', test1);

// Case 2: 3rd party stop-word
const test2 = checkDescriptionBlacklist('3 лицо не принимаю, оплата строго со своей карты', DEFAULT_STOP_WORDS, 1400);
console.assert(test2.blocked === true, 'Failed: should block "3 лицо"');
console.log('Test 2 (3 лицо):', test2);

// Case 3: Only 1st person stop-word
const test3 = checkDescriptionBlacklist('Только 1 лицо, дропов лесом', DEFAULT_STOP_WORDS, 1400);
console.assert(test3.blocked === true, 'Failed: should block "только 1 лицо"');
console.log('Test 3 (только 1 лицо):', test3);

// Case 4: Fixed denomination incompatible with 1400
const test4 = checkDescriptionBlacklist('Быстро отпускаю. Заходите на суммы 500/1000/2000/5000', DEFAULT_STOP_WORDS, 1400);
console.assert(test4.blocked === true, 'Failed: should block incompatible denomination');
console.log('Test 4 (суммы 500/1000/2000 vs 1400):', test4);

// Case 5: Clean description
const test5 = checkDescriptionBlacklist('Быстрый перевод без лишних вопросов, чек прикреплю', DEFAULT_STOP_WORDS, 1400);
console.assert(test5.blocked === false, 'Failed: should allow clean description');
console.log('Test 5 (clean):', test5);

console.log('\n--- Testing evaluateAd ---');
const baseSettings = {
  token: 'USDT',
  fiat: 'RUB',
  side: '1',
  targetAmount: '1400',
  triggerMode: 'market_diff',
  minDiscountDiff: '1.0',
  minOrders: 15,
  minRate: 85,
  enableBlacklist: true,
  stopWords: DEFAULT_STOP_WORDS
};

const marketBenchmark = 85.00;

// Ad 1: Hot deal (82.00, fits 1400, clean)
const hotAd = {
  id: '1001',
  price: '82.00',
  minAmount: '1000',
  maxAmount: '10000',
  recentOrderNum: '450',
  recentExecuteRate: '98.5',
  remark: 'Быстрая оплата Т-Банк',
  payments: ['582'],
  authMaker: true
};

const eval1 = evaluateAd(hotAd, baseSettings, marketBenchmark);
console.assert(eval1.passed === true, 'Failed: hot deal should pass');
console.log('Hot deal eval:', eval1);

// Ad 2: Normal price (85.20 -> not profitable)
const normalAd = { ...hotAd, id: '1002', price: '85.20' };
const eval2 = evaluateAd(normalAd, baseSettings, marketBenchmark);
console.assert(eval2.passed === false, 'Failed: normal price should not pass');
console.log('Normal price eval:', eval2.reason);

// Ad 3: Hot price but limit doesn't fit (minAmount 2000 > 1400)
const badLimitAd = { ...hotAd, id: '1003', minAmount: '2000', maxAmount: '50000' };
const eval3 = evaluateAd(badLimitAd, baseSettings, marketBenchmark);
console.assert(eval3.passed === false, 'Failed: limit should not pass');
console.log('Bad limit eval:', eval3.reason);

// Ad 4: Hot price but scam remark ("комиссия 300")
const scamRemarkAd = { ...hotAd, id: '1004', remark: 'Перевод моментальный, комиссия 300 руб с вас' };
const eval4 = evaluateAd(scamRemarkAd, baseSettings, marketBenchmark);
console.assert(eval4.passed === false, 'Failed: scam remark should not pass');
console.log('Scam remark eval:', eval4.reason);

console.log('\n--- Testing calculateBenchmarkPrice ---');
const items = [
  { price: '82.00' }, // anomaly cheap
  { price: '85.10' },
  { price: '85.20' },
  { price: '85.30' },
  { price: '85.50' }
];
const benchmark = calculateBenchmarkPrice(items, true);
console.log('Calculated benchmark:', benchmark);
console.assert(benchmark > 85.0 && benchmark < 85.3, 'Failed: benchmark should ignore anomalous 82.00');

console.log('\nALL TESTS PASSED SUCCESSFULLY! ✅');
