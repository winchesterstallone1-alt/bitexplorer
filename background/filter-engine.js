// filter-engine.js - Intelligent filtering for Bybit P2P offers with ironclad anti-obfuscation

export const DEFAULT_STOP_WORDS = [
  'комисси',
  'комса',
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
 * Ironclad de-obfuscation and normalization
 * Detects leetspeak (к0миcciя, 6ОО, 3 лuцо, к.о.м.и.с.с.и.я, etc.)
 */
export function normalizeIronclad(str) {
  if (!str) return { raw: '', clean: '', deLeeted: '', compact: '' };

  let raw = String(str).toLowerCase();

  // 1. Remove zero-width characters and invisible unicode spaces
  raw = raw.replace(/[\u200B-\u200F\uFEFF\u00A0\u00AD\u2060\u180E\r\n\t]/g, ' ');

  // 2. Decode numbers disguised with letters like '6ОО' -> '600' or '12ОО' -> '1200'
  let clean = raw.replace(/(\d+)[oоOО]{1,4}/gi, (match, digits) => {
    return digits + '0'.repeat(match.length - digits.length);
  });

  // 3. Homoglyph / Confusable character mapping
  const homoglyphs = {
    'a': 'а', '@': 'а',
    'b': 'в',
    'c': 'с', '$': 'с', '¢': 'с',
    'e': 'е', 'ё': 'е', '€': 'е',
    'k': 'к',
    'm': 'м',
    'n': 'п',
    'o': 'о', 'ø': 'о', 'ö': 'о',
    'p': 'р',
    't': 'т',
    'x': 'х', '%': 'х',
    'y': 'у',
    'h': 'н',
    'i': 'и', '!': 'и', '|': 'и', 'l': 'л', 'u': 'и', 'і': 'и', 'ї': 'и',
    'z': 'з'
  };

  let deLeeted = '';
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    // Contextual leet digit decoding (e.g. '0' in 'к0мисс' -> 'о', '1' in 'л1цо' -> 'и', '3' in '3лuцо' preserved for 3-е лицо)
    if (ch === '0') {
      const prev = clean[i - 1] || ' ';
      const next = clean[i + 1] || ' ';
      if (/[а-яa-z]/i.test(prev) || /[а-яa-z]/i.test(next)) {
        deLeeted += 'о';
        continue;
      }
    } else if (ch === '1' || ch === '!') {
      const prev = clean[i - 1] || ' ';
      const next = clean[i + 1] || ' ';
      if (/[а-яa-z]/i.test(prev) && /[а-яa-z]/i.test(next)) {
        deLeeted += 'и';
        continue;
      }
    } else if (ch === '3') {
      const prev = clean[i - 1] || ' ';
      const next = clean[i + 1] || ' ';
      if (/[а-яa-z]/i.test(prev) && /[а-яa-z]/i.test(next)) {
        deLeeted += 'з';
        continue;
      }
    }

    deLeeted += homoglyphs[ch] || ch;
  }

  // 4. Collapse runs of 3+ identical letters ("коооомиссия" -> "комиссия")
  const collapsed = deLeeted.replace(/([а-яa-z])\1{2,}/gi, '$1$1');

  // 5. Compact version: remove all spaces, dots, dashes, underscores between letters
  // "к . о . м . и . с . с . и . я" -> "комиссия", "3 - е л и ц о" -> "3елицо"
  const compact = collapsed.replace(/[\s\.\,\-\_\*\/\#\:\;\(\)\+]+/g, '');

  return {
    raw,
    clean: clean.replace(/\s+/g, ' ').trim(),
    deLeeted: collapsed.replace(/\s+/g, ' ').trim(),
    compact
  };
}

/**
 * Ironclad pattern rules for detecting hidden conditions, fees, and requirements
 */
export const IRONCLAD_PATTERNS = [
  // 1. Commission / Surcharge ("к0миcciя", "комса", "к.о.м.и.с.с.и.я 6ОО", "+200р с вас", "ком. 300")
  {
    name: 'Комиссия / Доплата',
    regex: /(?:к[о0o][мm][иi1!u][сc$]{1,3}|к[о0o][мm][сc$][а-яa-z]*|\bк[о0o][мm]\b|\+\s*\d+\s*(?:р|руб|rub|₽)?\s*(?:с|на|за)|(?:доплат|побор|комса|комсы|с\s*вас\s*\d+))/i,
    compactRegex: /(?:комис|комс|к0м|доплат|\+\d+р)/i
  },

  // 2. 3rd-party cards / transfers ("3 лицо не принимаю", "3 лuцо", "от 3-х лиц", "3лицо")
  {
    name: '3-е лицо (сторонняя карта)',
    regex: /(?:3\s*[-_.]?\s*(?:е|ье|ий|ья|ьего|ьих|ьим|им|м)?\s*(?:л[иi1!u][цc]|лиц|карт|card)|(?:от|с)\s*(?:3|трет)[^\w\sа-я]*(?:х|их|ьих|его)?\s*(?:лиц|л[иi1!u][цc]|карт)|(?:не|без)\s*(?:принимаю|перевожу|беру|шлю)?\s*(?:от\s*)?3\s*(?:лиц|л[иi1!u][цc])|3[лl][иi1!u][цc]|треть[иея][^\w\sа-я]*лиц)/i,
    compactRegex: /(?:3лиц|3-лиц|третьелиц|от3лиц|3карт)/i
  },

  // 3. Only 1st-person / Strictly own card ("только 1 лицо", "строго со своей", "т0льк0 1 л!цо")
  {
    name: 'Требование только 1-го лица',
    regex: /(?:только|строго|исключительно)\s*(?:с|со|от)?\s*(?:1|перв)[^\w\sа-я]*(?:го|ого|е|ое)?\s*(?:лиц|л[иi1!u]ц|карт|своей)|(?:1|перв)[^\w\sа-я]*(?:ое|е|лиц)\s*(?:лицо|л[иi1!u]цо)|(?:только|строго)\s*(?:со\s*своей|с\s*собственной|своего\s*лица)|(?:чужие|левые|дроп)[^\w\sа-я]*(?:карты|счета|чеки|флаги)/i,
    compactRegex: /(?:только1лиц|строго1лиц|толькососвоей|дропы|дроп)/i
  },

  // 4. Fixed batch / forced denominations ("заходите на суммы 500/1000/2000")
  {
    name: 'Навязанные фиксированные суммы',
    regex: /(?:заходите|входите)\s+(?:на\s+)?(?:сумм[ыа]\s+)?\d+|(?:только|строго|суммы:?)\s*(?:на\s*)?(?:сумм[ыа]\s*)?(?:\d+[\s\/\,]+){2,}\d+/i,
    compactRegex: /заходитенасуммы/i
  },

  // 5. ATM receipts / holding ("чек с банкомата", "холд 24ч", "сбер первый")
  {
    name: 'Чек с банкомата / Холдинг',
    regex: /(?:чек|фот[оа])\s*(?:с|из)\s*(?:банкомат|терминал)|(?:холдинг|холд|заморозк)\s*\d*|сбер\s*первый/i,
    compactRegex: /(?:чекбанкомат|холдинг|сберпервый)/i
  }
];

/**
 * Checks if description contains any blacklisted stop-words or incompatible denominations
 */
export function checkDescriptionBlacklist(remark, stopWords = DEFAULT_STOP_WORDS, targetAmount = null) {
  if (!remark) return { blocked: false, reason: null };

  const norm = normalizeIronclad(remark);

  // 1. Ironclad regex patterns check (covers masked/leetspeak like "к0миcciя 6ОО", "3 лuцо", etc.)
  for (const pattern of IRONCLAD_PATTERNS) {
    if (pattern.regex.test(norm.raw) || pattern.regex.test(norm.clean) || pattern.regex.test(norm.deLeeted) || pattern.compactRegex.test(norm.compact)) {
      // Special validation for denominations:
      if (pattern.name === 'Навязанные фиксированные суммы' && targetAmount) {
        const match = norm.clean.match(pattern.regex);
        if (match) {
          const numbers = match[0].match(/\b\d+\b/g);
          if (numbers && numbers.length > 1) {
            const allowed = numbers.map(Number);
            if (allowed.includes(Number(targetAmount))) {
              // User's target amount matches one of the denominations! Allow!
              continue;
            }
            return {
              blocked: true,
              reason: `Требуются фиксированные суммы (${allowed.join('/')}), а ваша сумма ${targetAmount}`
            };
          }
        }
      }

      return {
        blocked: true,
        reason: `Обнаружено скрытое условие [${pattern.name}] в описании`
      };
    }
  }

  // 2. Custom user-defined stop-words check against all normalized representations
  if (Array.isArray(stopWords)) {
    for (const phrase of stopWords) {
      const p = phrase.trim().toLowerCase();
      if (!p) continue;

      const pNorm = normalizeIronclad(p);

      if (
        norm.raw.includes(pNorm.raw) ||
        norm.clean.includes(pNorm.clean) ||
        norm.deLeeted.includes(pNorm.deLeeted) ||
        norm.compact.includes(pNorm.compact)
      ) {
        return {
          blocked: true,
          reason: `Стоп-слово в описании: "${phrase}"`
        };
      }
    }
  }

  // 3. Fallback denomination check if not caught by pattern
  if (targetAmount) {
    const denomRegex = /(?:заходите|входите|суммы|только|по)\s+(?:на\s+)?(?:сумм[ыа]\s+)?([0-9\s\/\,\.]+)/i;
    const match = norm.clean.match(denomRegex);
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
  const isBuyingCrypto = (settings.side === '1' || settings.side === 1 || !settings.side);
  let isProfitable = false;
  let profitDetails = '';

  const triggerMode = settings.triggerMode || 'market_diff';

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
      const minDiff = parseFloat(settings.minDiscountDiff || '1.0');
      if (diffRub >= minDiff) {
        isProfitable = true;
        profitDetails = `Дешевле рынка на ${diffRub.toFixed(2)} ${settings.fiat || 'RUB'} (${diffPct.toFixed(2)}%)`;
      } else {
        return { passed: false, reason: `Разница с рынком ${diffRub.toFixed(2)} меньше порога (${minDiff})` };
      }
    }
  } else {
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

  if (validPrices.length >= 3) {
    const sample = validPrices.slice(1, Math.min(validPrices.length, 5));
    const sum = sample.reduce((acc, v) => acc + v, 0);
    return Number((sum / sample.length).toFixed(2));
  }

  return validPrices[0];
}
