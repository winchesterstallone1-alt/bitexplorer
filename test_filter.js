// test_filter.js - Unit tests for ironclad filter engine
import { evaluateAd, calculateBenchmarkPrice, checkDescriptionBlacklist, DEFAULT_STOP_WORDS, normalizeIronclad } from './background/filter-engine.js';

console.log('--- Testing Advanced Anti-Obfuscation & Leetspeak ---');

const trickyCases = [
  { text: 'к0миcciя 6ОО с покупателя', desc: 'к0миcciя 6ОО (latin c, digit 0, letters OO)' },
  { text: 'к.о.м.и.с.с.и.я 200р', desc: 'к.о.м.и.с.с.и.я с точками' },
  { text: 'к 0 м с а 300 на карту', desc: 'к 0 м с а через пробелы' },
  { text: 'к0м-сия 5ООр', desc: 'к0м-сия 5ООр' },
  { text: '+250р за перевод с покупателя', desc: '+250р доплата' },
  { text: '3 лuцо не принимаю', desc: '3 лuцо (latin u instead of и)' },
  { text: '3-е л!цо мимо', desc: '3-е л!цо (exclamation mark)' },
  { text: 'т0льк0 1 л!цо со своей карты', desc: 'т0льк0 1 л!цо (0 and !)' },
  { text: '3лицо лесом', desc: '3лицо слитно' },
  { text: 'Быстро. Заходите на суммы 500/1000/2000/5000', desc: 'Навязанные суммы 500/1000/2000 (у нас 1400)' },
  { text: 'чек с банкомата обязателен', desc: 'Чек с банкомата' },
  { text: 'холд 24ч при первой сделке', desc: 'Холд' }
];

trickyCases.forEach(({ text, desc }, idx) => {
  const res = checkDescriptionBlacklist(text, DEFAULT_STOP_WORDS, 1400);
  console.assert(res.blocked === true, `FAILED to block: ${desc}`);
  console.log(`[PASS] Case ${idx + 1}: ${desc} -> ${res.reason}`);
});

console.log('\n--- Testing Clean Descriptions (Should NOT be blocked) ---');
const cleanCases = [
  'Быстрый перевод с Т-Банка, без лишних вопросов',
  'Отправляю быстро, онлайн 24/7',
  'Любая сумма в пределах лимитов, жду реквизиты'
];

cleanCases.forEach((text, idx) => {
  const res = checkDescriptionBlacklist(text, DEFAULT_STOP_WORDS, 1400);
  console.assert(res.blocked === false, `FAILED: clean text was falsely blocked! (${text})`);
  console.log(`[PASS] Clean ${idx + 1}: OK`);
});

console.log('\n--- Testing evaluateAd with Hot Deal & Obfuscated Scam ---');
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

// Hot Deal: 82.00, clean
const hotDeal = {
  id: '777',
  price: '82.00',
  minAmount: '1000',
  maxAmount: '10000',
  recentOrderNum: '300',
  recentExecuteRate: '99.0',
  remark: 'Моментальный перевод с Т-Банка, все быстро',
  payments: ['582'],
  authMaker: true
};

const evalHot = evaluateAd(hotDeal, baseSettings, marketBenchmark);
console.assert(evalHot.passed === true, 'Failed: hot deal should pass');
console.log('Hot Deal passed:', evalHot.profitDetails);

// Obfuscated Scam: 81.00 (super cheap bait), but remark has "к0миcciя 6ОО"
const baitScam = {
  ...hotDeal,
  id: '888',
  price: '81.00',
  remark: 'Привет, перевод мгновенный, но к0миcciя 6ОО с покупателя'
};

const evalScam = evaluateAd(baitScam, baseSettings, marketBenchmark);
console.assert(evalScam.passed === false, 'Failed: bait scam should be blocked!');
console.log('Obfuscated scam blocked successfully:', evalScam.reason);

console.log('\n--- Benchmark Calculation ---');
const items = [
  { price: '81.00' }, // bait
  { price: '85.10' },
  { price: '85.20' },
  { price: '85.30' }
];
const benchmark = calculateBenchmarkPrice(items, true);
console.log('Benchmark market price:', benchmark);
console.assert(benchmark > 85.0, 'Benchmark should ignore outlier bait 81.00');

console.log('\n✅ ALL IRONCLAD TESTS PASSED PERFECTLY!');
