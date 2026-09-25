// filter-engine.js - Intelligent filtering for Bybit P2P offers

export const DEFAULT_STOP_WORDS = [
  'комисси',
  '3 лицо',
  '3-е лицо',
  '3е лицо',
  'третье лицо',
  'третьих лиц',
  '3-го лица',
  '3го лица',
  'третьему лицу',
  'от третьих',
  'только 1 лицо',
  'только 1-е лицо',
  'только первое лицо',
  'только 1лицо',
  'со своего лица',
  'со своей карты',
  'с чужих карт не',
  'заходите на суммы',
  'суммы:',
  'чек с банкомата',
  'чек из банкомата',
  'чек с терминала',
  'чек наличных',
  'сбер первый',
  'сберпервый',
  'холдинг',
  'холд'
];

/**
 * Normalizes text to catch obfuscated scam words (e.g. latin 'c' for cyrillic 'с')
 */
export function normalizeText(str) {
  if (!str) return '';
  const charMap = {
    'a': 'а', 'e': 'е', 'o': 'о', 'p': 'р', 'c': 'с', 'y': 'у', 'x': 'х',
    'k': 'к', 'm': 'м', 't': 'т', 'b': 'в', 'h': 'н', 'u': 'и', '3': 'з'
  };
  let lower = str.toLowerCase().replace(/\s+/g, ' ');
  let converted = '';
  for (let ch of lower) {
    converted += charMap[ch] || ch;
  }
  return { original: lower, converted };
}

/**
 * Checks if description contains any blacklisted stop-words or incompatible denominations
 */
export function checkDescriptionBlacklist(remark, stopWords = DEFAULT_STOP_WORDS, targetAmount = null) {
  if (!remark) return { blocked: false, reason: null };

  const { original, converted } = normalizeText(remark);

  // 1. Check against blacklist phrases
  for (const phrase of stopWords) {
    const p = phrase.trim().toLowerCase();
    if (!p) continue;
    const { original: pOrig, converted: pConv } = normalizeText(p);

    if (original.includes(pOrig) || converted.includes(pConv)) {
      return {
        blocked: true,
        reason: `Стоп-слово в описании: "${phrase}"`
      };
    }
  }

  // 2. Specific check: "заходите на суммы 500/1000/2000"
  // If user has a specific amount like 1400, check if seller requires fixed amounts
  if (targetAmount) {
    const denomRegex = /(?:заходите|входите|суммы|только|по)\s+(?:на\s+)?(?:суммы\s+)?([0-9\s\/\,\.]+)/i;
    const match = remark.match(denomRegex);
    if (match) {
      const numbersInRemark = match[1].match(/\b\d+\b/g);
      if (numbersInRemark && numbersInRemark.length > 1) {
        const allowedNums = numbersInRemark.map(Number);
        if (!allowedNums.includes(Number(targetAmount))) {
          return {
            blocked: true,
            reason: `Требуются фиксированные суммы (${allowedNums.join('/')}), а у вас ${targetAmount}`
          };
        }
      }
    }
  }

  return { blocked: false, reason: null };
}

/**
 * Evaluates whether an ad passes merchant reputation, limits, and profitability triggers
 */
export function evaluateAd(item, settings, marketBenchmarkPrice = null) {
  const price = parseFloat(item.price);
  const minAmount = parseFloat(item.minAmount);
  const maxAmount = parseFloat(item.maxAmount);
  const orderNum = parseInt(item.recentOrderNum || '0', 10);
  const executeRate = parseFloat(item.recentExecuteRate || '0');
  const remark = item.remark || item.tradingTerms || '';

  // 1. Check target amount limits (e.g. 1400 RUB)
  if (settings.targetAmount && settings.targetAmount > 0) {
    const target = Number(settings.targetAmount);
    if (target < minAmount || target > maxAmount) {
      return {
        passed: false,
        reason: `Сумма ${target} не входит в лимиты ордера (${minAmount} - ${maxAmount})`
      };
    }
  }

  // 2. Check general limits if user set custom min/max
  if (settings.filterMinAmount && maxAmount < settings.filterMinAmount) {
    return { passed: false, reason: `Макс. лимит ордера (${maxAmount}) меньше минимального фильтра` };
  }
  if (settings.filterMaxAmount && minAmount > settings.filterMaxAmount) {
    return { passed: false, reason: `Мин. лимит ордера (${minAmount}) больше максимального фильтра` };
  }

  // 3. Check Blacklist / Stop-words in remark & nickname
  if (settings.enableBlacklist !== false) {
    const stopWords = settings.stopWords || DEFAULT_STOP_WORDS;
    const remarkCheck = checkDescriptionBlacklist(remark, stopWords, settings.targetAmount);
    if (remarkCheck.blocked) {
      return { passed: false, reason: remarkCheck.reason };
    }

    // Also check nickName for suspicious terms
    const nickCheck = checkDescriptionBlacklist(item.nickName, stopWords);
    if (nickCheck.blocked) {
      return { passed: false, reason: `Стоп-слово в никнейме: "${nickCheck.reason}"` };
    }
  }

  // 4. Merchant reputation checks
  const minOrders = settings.minOrders !== undefined ? Number(settings.minOrders) : 10;
  const minRate = settings.minRate !== undefined ? Number(settings.minRate) : 85;

  if (orderNum < minOrders) {
    return { passed: false, reason: `Мало сделок: ${orderNum} (нужно >= ${minOrders})` };
  }

  if (executeRate < minRate) {
    return { passed: false, reason: `Низкий % выполнения: ${executeRate}% (нужно >= ${minRate}%)` };
  }

  if (settings.onlyVerified && !item.authMaker) {
    return { passed: false, reason: 'Мерчант не верифицирован (требуется галочка Проверенный)' };
  }

  // 5. Payment method filter (if specified)
  if (settings.paymentMethods && settings.paymentMethods.length > 0) {
    const itemPayments = item.payments || [];
    const hasAllowedPayment = settings.paymentMethods.some(pm =>
      itemPayments.includes(String(pm)) || itemPayments.includes(Number(pm))
    );
    if (!hasAllowedPayment) {
      return { passed: false, reason: 'Неподходящий способ оплаты' };
    }
  }

  // 6. Profitability / Target condition check
  // Side = "1" -> User is buying crypto (wants lowest price)
  // Side = "0" -> User is selling crypto (wants highest price)
  const isBuyingCrypto = (settings.side === '1' || settings.side === 1 || !settings.side);
  let isProfitable = false;
  let profitDetails = '';

  const triggerMode = settings.triggerMode || 'market_diff'; // 'market_diff', 'fixed_price', 'discount_percent'

  if (triggerMode === 'fixed_price') {
    const fixedTarget = parseFloat(settings.fixedTargetPrice);
    if (!isNaN(fixedTarget) && fixedTarget > 0) {
      if (isBuyingCrypto && price <= fixedTarget) {
        isProfitable = true;
        const diff = (fixedTarget - price).toFixed(2);
        profitDetails = `Цена ${price} <= цели ${fixedTarget} (выгода ${diff} ${settings.fiat || 'RUB'})`;
      } else if (!isBuyingCrypto && price >= fixedTarget) {
        isProfitable = true;
        const diff = (price - fixedTarget).toFixed(2);
        profitDetails = `Цена ${price} >= цели ${fixedTarget} (выгода +${diff} ${settings.fiat || 'RUB'})`;
      } else {
        return { passed: false, reason: `Цена ${price} не достигла целевой (${fixedTarget})` };
      }
    }
  } else if (marketBenchmarkPrice && marketBenchmarkPrice > 0) {
    // Relative to benchmark market price
    const diffRub = isBuyingCrypto ? (marketBenchmarkPrice - price) : (price - marketBenchmarkPrice);
    const diffPct = (diffRub / marketBenchmarkPrice) * 100;

    if (triggerMode === 'discount_percent') {
      const minPct = parseFloat(settings.minDiscountPercent || '1.5');
      if (diffPct >= minPct) {
        isProfitable = true;
        profitDetails = `Скидка ${diffPct.toFixed(2)}% от рынка (${diffRub.toFixed(2)} ${settings.fiat || 'RUB'})`;
      } else {
        return { passed: false, reason: `Скидка ${diffPct.toFixed(2)}% ниже требуемой (${minPct}%)` };
      }
    } else {
      // Default: 'market_diff' in absolute fiat currency (e.g. cheaper by >= 1.50 RUB)
      const minDiff = parseFloat(settings.minDiscountDiff || '1.0');
      if (diffRub >= minDiff) {
        isProfitable = true;
        profitDetails = `Дешевле рынка на ${diffRub.toFixed(2)} ${settings.fiat || 'RUB'} (${diffPct.toFixed(2)}%)`;
      } else {
        return { passed: false, reason: `Разница с рынком ${diffRub.toFixed(2)} меньше порога (${minDiff})` };
      }
    }
  } else {
    // If no market benchmark yet or any matching ad is acceptable
    isProfitable = true;
    profitDetails = `Цена: ${price} ${settings.fiat || 'RUB'}`;
  }

  if (isProfitable) {
    return {
      passed: true,
      profitDetails,
      item: {
        id: item.id,
        price,
        nickName: item.nickName,
        minAmount,
        maxAmount,
        orderNum,
        executeRate,
        payments: item.payments || [],
        remark,
        authMaker: !!item.authMaker,
        token: settings.token || 'USDT',
        fiat: settings.fiat || 'RUB',
        side: settings.side || '1',
        timestamp: Date.now()
      }
    };
  }

  return { passed: false, reason: 'Не соответствует критериям выгодности' };
}

/**
 * Calculates the standard baseline market price by taking a robust average/median of the top regular offers
 */
export function calculateBenchmarkPrice(items, isBuyingCrypto = true) {
  if (!items || items.length === 0) return null;

  const validPrices = items
    .map(i => parseFloat(i.price))
    .filter(p => !isNaN(p) && p > 0);

  if (validPrices.length === 0) return null;

  validPrices.sort((a, b) => a - b);

  // If buying crypto, lowest price is top.
  // To avoid comparing an anomalous mispriced ad against itself,
  // we take the price of the 2nd or 3rd regular ad or median of top 5
  if (validPrices.length >= 3) {
    // E.g. if ads are [82, 85.1, 85.2, 85.3, 85.5]
    // The benchmark should represent the true prevailing market price (85.2)
    const sample = validPrices.slice(1, Math.min(validPrices.length, 5));
    const sum = sample.reduce((acc, v) => acc + v, 0);
    return Number((sum / sample.length).toFixed(2));
  }

  return validPrices[0];
}
