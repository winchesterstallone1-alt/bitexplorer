// filter-engine.js - Intelligent filtering for Bybit P2P offers with 3rd-party acceptance detection & anti-obfuscation

export const DEFAULT_STOP_WORDS = [
  'комисси',
  'комса',
  '3 лицо не принимаю',
  '3 лицо не беру',
  '3 лицо мимо',
  'не принимаю 3 лицо',
  'не беру 3 лицо',
  'от 3 лиц не',
  'от 3-х лиц не',
  'без 3 лиц',
  'только 1 лицо',
  'только 1-е лицо',
  'только первое лицо',
  'только 1лицо',
  'со своего лица',
  'со своей карты',
  'с чужих карт не',
  'дропы мимо',
  'дропы лесом',
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
    // Contextual leet digit decoding (e.g. '0' in 'к0мисс' -> 'о', '1' in 'л1цо' -> 'и')
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
  const compact = collapsed.replace(/[\s\.\,\-\_\*\/\#\:\;\(\)\+]+/g, '');

  return {
    raw,
    clean: clean.replace(/\s+/g, ' ').trim(),
    deLeeted: collapsed.replace(/\s+/g, ' ').trim(),
    compact
  };
}

/**
 * Positive regex: Detects explicit allowance / welcome of 3rd-party payments
 * Examples: "3 лицо можно", "3 приму", "3 лицо приму", "1 и 3 лицо", "любое лицо", "с любых карт", "3-е лицо да"
 */
export const POSITIVE_THIRD_PARTY_REGEX = /(?:(?:3|трет)[^\w\sа-я]*(?:е|ье)?\s*(?:лиц[оа]|л[иi1!u]ц[оа]|карты?|card)?\s*(?:можно|приму|принимаю|беру|да|\+|ок|ok|приветствуется|разрешен[оа]|без\s*проблем)|(?:можно|приму|принимаю|беру|разрешен[оа])\s*(?:с|от)?\s*(?:3|трет)[^\w\sа-я]*(?:го|его)?\s*(?:лиц[ао]|л[иi1!u]ц[ао]|карты?)|(?:1|перв)[^\w\sа-я]*(?:ое)?\s*(?:и|\+|\/|,)\s*(?:3|трет)[^\w\sа-я]*(?:е|ье)?\s*(?:лиц[оа]|л[иi1!u]ц[оа]|карты?)|(?:любое|любая|все|каждое)\s*(?:лицо|карта|фио|отправитель)|(?:с\s*любых\s*карт|с\s*любой\s*карты)|(?:с\s*чужих\s*карт|с\s*чужой\s*карты)\s*(?:можно|приму|принимаю|да|\+|ок)|(?:фио|имя)\s*(?:не\s*важно|не\s*имеет\s*значения|любое)|3\s*(?:приму|беру|можно))/i;

/**
 * Negative regex: Detects strict prohibition of 3rd-party payments
 * Examples: "3 лицо не принимаю", "3 лицо мимо", "не беру от 3 лиц", "только 1 лицо", "строго со своей карты", "дропы мимо"
 */
export const NEGATIVE_THIRD_PARTY_REGEX = /(?:(?:3|трет)[^\w\sа-я]*(?:е|ье)?\s*(?:лиц[оа]|л[иi1!u]ц[оа]|карты?|card)?\s*(?:не|нет|мимо|бан|отказ|лес|блокир|запрет|отклоняю|не\s*принимаю|не\s*беру)|(?:не|нет|без|никаких)\s*(?:принимаю|перевожу|беру|шлю)?\s*(?:с|от)?\s*(?:3|трет)[^\w\sа-я]*(?:х|их|ьих|его)?\s*(?:лиц|л[иi1!u]ц|карт)|(?:только|строго|исключительно)\s*(?:с|со|от)?\s*(?:1|перв)[^\w\sа-я]*(?:го|ого|е|ое)?\s*(?:лиц|л[иi1!u]ц|карт|своей)|(?:1|перв)[^\w\sа-я]*(?:ое|е|лиц)\s*(?:лицо|л[иi1!u]цо)|(?:только|строго)\s*(?:со\s*своей|с\s*собственной|своего\s*лица)|(?:чужие|левые|дроп)[^\w\sа-я]*(?:карты|счета|чеки|флаги)|(?:дроп[ыа]?\s*(?:мимо|лесом|бан|отказ|не|нет))|3лицо\s*(?:не|нет|мимо)|(?:только1лиц|строго1лиц|толькососвоей))/i;

/**
 * Classifies merchant description regarding 3rd-party payment acceptability
 */
export function classifyThirdParty(remark) {
  if (!remark) return { status: 'neutral', isAllowed: false, text: 'Не указано' };

  const norm = normalizeIronclad(remark);

  // Check positive first: "3 лицо можно", "1 и 3 лицо", "любое лицо"
  if (POSITIVE_THIRD_PARTY_REGEX.test(norm.raw) || POSITIVE_THIRD_PARTY_REGEX.test(norm.clean) || POSITIVE_THIRD_PARTY_REGEX.test(norm.deLeeted)) {
    return {
      status: 'allowed',
      isAllowed: true,
      text: '🟢 3-е лицо разрешено'
    };
  }

  // Check negative: "3 лицо не принимаю", "только 1 лицо", "строго со своей"
  if (NEGATIVE_THIRD_PARTY_REGEX.test(norm.raw) || NEGATIVE_THIRD_PARTY_REGEX.test(norm.clean) || NEGATIVE_THIRD_PARTY_REGEX.test(norm.deLeeted) || NEGATIVE_THIRD_PARTY_REGEX.test(norm.compact)) {
    return {
      status: 'forbidden',
      isAllowed: false,
      text: '🔴 3-е лицо запрещено'
    };
  }

  return {
    status: 'neutral',
    isAllowed: false,
    text: '⚪ 3-е лицо: нейтрально (без запретов)'
  };
}

/**
 * Check if description contains fees or unwanted conditions
 */
export function checkDescriptionBlacklist(remark, stopWords = DEFAULT_STOP_WORDS, targetAmount = null, thirdPartyMode = 'explicit_only') {
  if (!remark) {
    if (thirdPartyMode === 'explicit_only') {
      return { blocked: true, reason: 'Нет явного подтверждения разрешения 3-го лица' };
    }
    return { blocked: false, reason: null, thirdParty: { status: 'neutral', isAllowed: false } };
  }

  const norm = normalizeIronclad(remark);

  // 1. Check 3rd-party acceptance based on user mode
  const thirdParty = classifyThirdParty(remark);

  if (thirdPartyMode === 'explicit_only') {
    // User strictly wants ads where 3rd party is confirmed ("3 лицо можно", "3 приму", "любое лицо")
    if (thirdParty.status !== 'allowed') {
      return {
        blocked: true,
        reason: thirdParty.status === 'forbidden'
          ? 'Мерчант запретил 3-е лицо (требует 1-е лицо)'
          : 'Нет фразы о разрешении 3-го лица ("3 лицо можно / приму")',
        thirdParty
      };
    }
  } else if (thirdPartyMode === 'allow_and_neutral') {
    // Block only if merchant explicitly forbids 3rd party
    if (thirdParty.status === 'forbidden') {
      return {
        blocked: true,
        reason: 'Мерчант запретил оплату с 3-го лица ("3 лицо не беру / только 1 лицо")',
        thirdParty
      };
    }
  }

  // 2. Commission / Surcharge Check (Exempt "без комиссии", "0% комиссия")
  let cleanNoFee = norm.clean.replace(/(?:без|нет|0%|zero|отсутствует)\s*(?:скрытых\s*)?комисси[а-яa-z0-9]*/gi, '');
  const commissionRegex = /(?:к[о0o][мm][иi1!u][сc$]{1,3}|к[о0o][мm][сc$][а-яa-z]*|\bк[о0o][мm]\b|\+\s*\d+\s*(?:р|руб|rub|₽)?\s*(?:с|на|за)|(?:доплат|побор|комса|комсы|с\s*вас\s*\d+))/i;

  if (commissionRegex.test(cleanNoFee)) {
    return {
      blocked: true,
      reason: 'Обнаружена скрытая комиссия или доплата',
      thirdParty
    };
  }

  // 3. ATM receipts / holding ("чек с банкомата", "холд 24ч", "сбер первый")
  const atmHoldRegex = /(?:чек|фот[оа])\s*(?:с|из)\s*(?:банкомат|терминал)|(?:холдинг|холд|заморозк)\s*\d*|сбер\s*первый/i;
  if (atmHoldRegex.test(norm.raw) || atmHoldRegex.test(norm.clean)) {
    return {
      blocked: true,
      reason: 'Требуется чек с банкомата или холд',
      thirdParty
    };
  }

  // 4. Fixed batch / forced denominations ("заходите на суммы 500/1000/2000")
  const denomRegex = /(?:заходите|входите)\s+(?:на\s+)?(?:сумм[ыа]\s+)?\d+|(?:только|строго|суммы:?)\s*(?:на\s*)?(?:сумм[ыа]\s*)?(?:\d+[\s\/\,]+){2,}\d+/i;
  if (denomRegex.test(norm.clean) && targetAmount) {
    const match = norm.clean.match(denomRegex);
    if (match) {
      const numbers = match[0].match(/\b\d+\b/g);
      if (numbers && numbers.length > 1) {
        const allowed = numbers.map(Number);
        if (!allowed.includes(Number(targetAmount))) {
          return {
            blocked: true,
            reason: `Требуются фиксированные суммы (${allowed.join('/')}), а у вас ${targetAmount}`,
            thirdParty
          };
        }
      }
    }
  }

  // 5. Custom user stop-words check
  if (Array.isArray(stopWords)) {
    for (const phrase of stopWords) {
      const p = phrase.trim().toLowerCase();
      if (!p) continue;
      const pNorm = normalizeIronclad(p);

      const isCommStopWord = p.includes('комисс') || p.includes('комс');
      const targetText = isCommStopWord ? cleanNoFee : norm.clean;
      const targetRaw = isCommStopWord ? cleanNoFee : norm.raw;

      if (
        targetRaw.includes(pNorm.raw) ||
        targetText.includes(pNorm.clean) ||
        targetText.includes(pNorm.deLeeted)
      ) {
        return {
          blocked: true,
          reason: `Стоп-слово: "${phrase}"`,
          thirdParty
        };
      }
    }
  }

  return { blocked: false, reason: null, thirdParty };
}

/**
 * Evaluates whether an ad passes merchant reputation, limits, 3rd party, and profitability triggers
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

  // 3. Check Blacklist / 3rd Party / Stop-words
  const thirdPartyMode = settings.thirdPartyMode || 'explicit_only'; // 'explicit_only', 'allow_and_neutral', 'off'

  if (settings.enableBlacklist !== false) {
    const stopWords = settings.stopWords || DEFAULT_STOP_WORDS;
    const remarkCheck = checkDescriptionBlacklist(remark, stopWords, settings.targetAmount, thirdPartyMode);
    if (remarkCheck.blocked) {
      return { passed: false, reason: remarkCheck.reason, thirdParty: remarkCheck.thirdParty };
    }

    // Also check nickName for suspicious terms
    const nickCheck = checkDescriptionBlacklist(item.nickName, stopWords, null, 'off');
    if (nickCheck.blocked) {
      return { passed: false, reason: `Стоп-слово в никнейме: "${nickCheck.reason}"` };
    }
  }

  // Classify 3rd party status for UI badge
  const thirdParty = classifyThirdParty(remark);

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
        thirdPartyStatus: thirdParty.status,
        thirdPartyText: thirdParty.text,
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
