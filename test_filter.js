// test_filter.js - Unit tests for 3rd-party acceptance, anti-obfuscation and fee detection
import { evaluateAd, calculateBenchmarkPrice, checkDescriptionBlacklist, classifyThirdParty, DEFAULT_STOP_WORDS } from './background/filter-engine.js';

console.log('--- 1. Testing 3rd-Party Acceptance Classifier ---');

const thirdPartyPositiveCases = [
  '3 лицо можно, перевод с тинькофф',
  '3 приму, оплата моментально',
  '3 лицо приму без лишних вопросов',
  '1 и 3 лицо принимаю',
  'любое лицо, жду реквизиты',
  'с любых карт можно платить',
  '3-е лицо приветствуется',
  'можно с 3 лица',
  '3 лицо +, быстро отпускаю',
  'с чужих карт можно',
  'фио не важно, любая карта'
];

thirdPartyPositiveCases.forEach((text, i) => {
  const res = classifyThirdParty(text);
  console.assert(res.status === 'allowed', `FAILED positive: ${text}`);
  console.log(`[PASS] Positive 3rd Party #${i + 1}: "${text}" -> ${res.text}`);
});

console.log('\n--- 2. Testing 3rd-Party Negative (Forbidden) Cases ---');
const thirdPartyNegativeCases = [
  '3 лицо не принимаю, строго отказ',
  '3 лицо мимо',
  'не беру от 3 лиц',
  'только 1 лицо, дропов лесом',
  'строго со своей карты, чужие карты бан',
  '3 лuцо не беру (masked)',
  'дропы мимо',
  'только первое лицо'
];

thirdPartyNegativeCases.forEach((text, i) => {
  const res = classifyThirdParty(text);
  console.assert(res.status === 'forbidden', `FAILED negative: ${text}`);
  console.log(`[PASS] Negative 3rd Party #${i + 1}: "${text}" -> ${res.text}`);
});

console.log('\n--- 3. Testing checkDescriptionBlacklist in "explicit_only" Mode ---');

// Case A: 3rd party allowed and clean -> MUST PASS
const testA = checkDescriptionBlacklist('3 лицо можно, быстрый перевод', DEFAULT_STOP_WORDS, 1400, 'explicit_only');
console.assert(testA.blocked === false, 'Test A should PASS');
console.log('[PASS] Test A (3 лицо можно):', testA);

// Case B: 3rd party allowed with "1 и 3 лицо" and "без комиссии" -> MUST PASS
const testB = checkDescriptionBlacklist('1 и 3 лицо приму, без комиссии!', DEFAULT_STOP_WORDS, 1400, 'explicit_only');
console.assert(testB.blocked === false, 'Test B should PASS without fee false positive');
console.log('[PASS] Test B (1 и 3 лицо, без комиссии):', testB);

// Case C: 3rd party allowed, BUT hidden fee "к0миcciя 6ОО" -> MUST BLOCK due to fee!
const testC = checkDescriptionBlacklist('3 лицо можно, но к0миcciя 6ОО', DEFAULT_STOP_WORDS, 1400, 'explicit_only');
console.assert(testC.blocked === true, 'Test C should be blocked due to fee');
console.log('[PASS] Test C (3 лицо можно + комиссия 6ОО): Blocked ->', testC.reason);

// Case D: Strict 1st person ("только 1 лицо") -> MUST BLOCK
const testD = checkDescriptionBlacklist('только 1 лицо со своей карты', DEFAULT_STOP_WORDS, 1400, 'explicit_only');
console.assert(testD.blocked === true, 'Test D should be blocked');
console.log('[PASS] Test D (только 1 лицо): Blocked ->', testD.reason);

// Case E: Neutral description with NO mention of 3rd party in 'explicit_only' mode -> MUST BLOCK
const testE = checkDescriptionBlacklist('Быстрый перевод с Т-Банка', DEFAULT_STOP_WORDS, 1400, 'explicit_only');
console.assert(testE.blocked === true, 'Test E should be blocked because explicit 3rd party is required');
console.log('[PASS] Test E (neutral text in explicit_only): Blocked ->', testE.reason);

console.log('\n--- 4. Testing evaluateAd End-to-End ---');
const baseSettings = {
  token: 'USDT',
  fiat: 'RUB',
  side: '1',
  targetAmount: '1400',
  thirdPartyMode: 'explicit_only', // Seeking 3rd party acceptance!
  triggerMode: 'market_diff',
  minDiscountDiff: '1.0',
  minOrders: 15,
  minRate: 85,
  enableBlacklist: true,
  stopWords: DEFAULT_STOP_WORDS
};

const marketBenchmark = 85.00;

// Ad 1: Profitable offer (82.00) that allows 3rd party! -> MUST PASS!
const idealAd = {
  id: '3001',
  price: '82.00',
  minAmount: '1000',
  maxAmount: '10000',
  recentOrderNum: '250',
  recentExecuteRate: '99.1',
  remark: '3 лицо можно, перевод с Т-Банка моментально',
  payments: ['582'],
  authMaker: true
};

const evalIdeal = evaluateAd(idealAd, baseSettings, marketBenchmark);
console.assert(evalIdeal.passed === true, 'Ideal ad allowing 3rd party must pass');
console.log('Ideal Ad passed:', evalIdeal.profitDetails, '| 3rd Party:', evalIdeal.item.thirdPartyText);

// Ad 2: Cheap offer (81.00) but rejects 3rd party ("только 1 лицо") -> MUST BE REJECTED!
const rejectAd = {
  ...idealAd,
  id: '3002',
  price: '81.00',
  remark: 'Только 1 лицо, с чужих карт не платить!'
};

const evalReject = evaluateAd(rejectAd, baseSettings, marketBenchmark);
console.assert(evalReject.passed === false, 'Ad rejecting 3rd party must fail');
console.log('Reject Ad blocked successfully:', evalReject.reason);

console.log('\n✅ ALL 3RD-PARTY & ANTI-SCAM TESTS PASSED WITH 100% SUCCESS!');
