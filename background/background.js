// background.js - Background service worker for Bybit P2P Radar
import { fetchP2PItems, getBybitSessionStatus } from './bybit-api.js';
import { evaluateAd, calculateBenchmarkPrice, DEFAULT_STOP_WORDS } from './filter-engine.js';

const ALARM_NAME = 'bybit_radar_keepalive';
let isRunning = false;
let pollingTimer = null;
const notifiedAds = new Map(); // adId -> { price, timestamp }
let lastBenchmarkPrice = null;
let lastCheckTime = null;
let lastStatusMessage = 'Готов к запуску';

// Default initial settings
export const DEFAULT_SETTINGS = {
  isRunning: false,
  token: 'USDT',
  fiat: 'RUB',
  side: '1', // 1 = Покупка крипты (выгодные дешевые ордера), 0 = Продажа крипты
  targetAmount: '1400', // Целевая сумма обмена (например 1400)
  paymentMethods: [], // [] - все, ['582'] - Т-Банк, ['581'] - Сбербанк
  triggerMode: 'market_diff', // 'market_diff', 'discount_percent', 'fixed_price'
  minDiscountDiff: '1.0', // Дешевле рынка на 1.0 руб
  minDiscountPercent: '1.5', // Дешевле рынка на 1.5%
  fixedTargetPrice: '83.00', // Фиксированная цена
  intervalSeconds: 5, // Частота опроса
  thirdPartyMode: 'explicit_only', // 'explicit_only' (только где написано '3 лицо можно/приму'), 'allow_and_neutral', 'off'
  enableBlacklist: true,
  stopWords: DEFAULT_STOP_WORDS,
  minOrders: 15,
  minRate: 85,
  onlyVerified: false,
  enableSound: true,
  soundType: 'alert', // 'alert', 'radar', 'cash'
  enablePush: true,
  autoOpenTab: false,
  recentMatches: []
};

// Initialize settings on installation
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get('settings');
  if (!data.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  } else {
    // Merge new defaults if any fields were added
    const merged = { ...DEFAULT_SETTINGS, ...data.settings };
    await chrome.storage.local.set({ settings: merged });
  }
  console.log('[Bybit Radar] Installed and initialized.');
});

// Restore monitoring state on browser startup
chrome.runtime.onStartup.addListener(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  if (settings && settings.isRunning) {
    startMonitoring();
  }
});

// Handle keepalive alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME && isRunning) {
    if (!pollingTimer) {
      scheduleNextPoll(1000);
    }
  }
});

// Manage offscreen document for playing sounds in MV3
async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return;
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Оповещение пользователя о найденном выгодном ордере на Bybit P2P'
    });
  } catch (err) {
    console.warn('[Bybit Radar] Offscreen creation error:', err);
  }
}

async function playAlertSound(soundType = 'alert') {
  try {
    await ensureOffscreenDocument();
    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'PLAY_SOUND',
      soundType,
      volume: 0.9
    });
  } catch (err) {
    console.error('[Bybit Radar] Sound playback error:', err);
  }
}

function showPushNotification(item, profitDetails, fiat) {
  const notifId = `bybit_p2p_${item.id}_${Date.now()}`;
  const tpTag = item.thirdPartyStatus === 'allowed' ? ' [👤 3-е лицо РАЗРЕШЕНО]' : '';
  const title = `🔥 Ордер: ${item.price} ${fiat}!${tpTag}`;
  const message = `${profitDetails}\n${item.thirdPartyText || ''}\nМерчант: ${item.nickName} (${item.executeRate}% выполнено, ${item.orderNum} сделок)\nЛимиты: ${item.minAmount} - ${item.maxAmount} ${fiat}`;

  chrome.notifications.create(notifId, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
    priority: 2,
    requireInteraction: true
  });

  // Store url mapping for this notification
  const adUrl = `https://www.bybit.com/fiat/otc/trade/buy/${item.token}/${item.id}?fiat=${fiat}`;
  chrome.storage.local.set({ [`url_${notifId}`]: adUrl });
}

chrome.notifications.onClicked.addListener(async (notifId) => {
  const key = `url_${notifId}`;
  const data = await chrome.storage.local.get(key);
  if (data[key]) {
    chrome.tabs.create({ url: data[key] });
    chrome.storage.local.remove(key);
  } else {
    chrome.tabs.create({ url: 'https://www.bybit.com/fiat/otc/' });
  }
});

/**
 * Main polling iteration
 */
async function pollBybitP2P() {
  if (!isRunning) return;

  const { settings } = await chrome.storage.local.get('settings');
  if (!settings || !settings.isRunning) {
    stopMonitoring();
    return;
  }

  try {
    lastCheckTime = Date.now();
    const result = await fetchP2PItems(settings);

    if (!result.success) {
      lastStatusMessage = `Ошибка API: ${result.error}`;
      scheduleNextPoll(settings.intervalSeconds * 1000);
      return;
    }

    const items = result.items || [];
    if (items.length === 0) {
      lastStatusMessage = 'Объявления не найдены по заданным фильтрам';
      scheduleNextPoll(settings.intervalSeconds * 1000);
      return;
    }

    // Determine current benchmark price from normal ads
    const isBuyingCrypto = (settings.side === '1' || settings.side === 1 || !settings.side);
    const benchmark = calculateBenchmarkPrice(items, isBuyingCrypto);
    if (benchmark) {
      lastBenchmarkPrice = benchmark;
    }

    lastStatusMessage = `В стакане ${items.length} ордеров. Рынок: ~${lastBenchmarkPrice || '-'} ${settings.fiat}`;

    const newMatches = [];

    for (const item of items) {
      const evaluation = evaluateAd(item, settings, lastBenchmarkPrice);
      if (evaluation.passed) {
        const found = evaluation.item;
        const now = Date.now();
        const prevAlert = notifiedAds.get(found.id);

        // Notify if newly detected or price improved and not alerted in last 10 minutes
        const shouldAlert = !prevAlert || (prevAlert.price !== found.price) || (now - prevAlert.timestamp > 10 * 60 * 1000);

        if (shouldAlert) {
          notifiedAds.set(found.id, { price: found.price, timestamp: now });
          found.profitDetails = evaluation.profitDetails;
          newMatches.push(found);

          // 1. Audio alert
          if (settings.enableSound) {
            playAlertSound(settings.soundType || 'alert');
          }

          // 2. Chrome push notification
          if (settings.enablePush) {
            showPushNotification(found, evaluation.profitDetails, settings.fiat);
          }

          // 3. Auto-open tab if configured
          if (settings.autoOpenTab) {
            const adUrl = `https://www.bybit.com/fiat/otc/trade/buy/${found.token}/${found.id}?fiat=${settings.fiat}`;
            chrome.tabs.create({ url: adUrl });
          }

          // 4. Send toast to active bybit tabs
          chrome.tabs.query({ url: '*://*.bybit.com/*' }, (tabs) => {
            tabs.forEach(tab => {
              chrome.tabs.sendMessage(tab.id, {
                action: 'SHOW_PAGE_ALERT',
                data: found
              }).catch(() => {});
            });
          });
        }
      }
    }

    if (newMatches.length > 0) {
      // Save matches to history (keep last 30)
      const existingMatches = settings.recentMatches || [];
      const updatedMatches = [...newMatches, ...existingMatches].slice(0, 30);
      settings.recentMatches = updatedMatches;
      await chrome.storage.local.set({ settings });
    }

  } catch (err) {
    console.error('[Bybit Radar] Polling loop error:', err);
    lastStatusMessage = `Сбой цикла: ${err.message}`;
  } finally {
    if (isRunning) {
      const intervalMs = Math.max(2000, (settings.intervalSeconds || 5) * 1000);
      scheduleNextPoll(intervalMs);
    }
  }
}

function scheduleNextPoll(delayMs) {
  if (pollingTimer) clearTimeout(pollingTimer);
  if (!isRunning) return;
  pollingTimer = setTimeout(pollBybitP2P, delayMs);
}

export function startMonitoring() {
  if (isRunning) return;
  isRunning = true;
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });
  scheduleNextPoll(500);
}

export function stopMonitoring() {
  isRunning = false;
  if (pollingTimer) {
    clearTimeout(pollingTimer);
    pollingTimer = null;
  }
  chrome.alarms.clear(ALARM_NAME);
  lastStatusMessage = 'Мониторинг остановлен';
}

// Communication with Popup & content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'START_MONITORING') {
    chrome.storage.local.get('settings', ({ settings }) => {
      const updated = { ...settings, isRunning: true };
      chrome.storage.local.set({ settings: updated }, () => {
        startMonitoring();
        sendResponse({ success: true });
      });
    });
    return true;
  }

  if (request.action === 'STOP_MONITORING') {
    chrome.storage.local.get('settings', ({ settings }) => {
      const updated = { ...settings, isRunning: false };
      chrome.storage.local.set({ settings: updated }, () => {
        stopMonitoring();
        sendResponse({ success: true });
      });
    });
    return true;
  }

  if (request.action === 'GET_STATE') {
    chrome.storage.local.get('settings', async ({ settings }) => {
      const session = await getBybitSessionStatus();
      sendResponse({
        isRunning,
        settings: settings || DEFAULT_SETTINGS,
        lastBenchmarkPrice,
        lastCheckTime,
        lastStatusMessage,
        session
      });
    });
    return true;
  }

  if (request.action === 'TEST_SOUND') {
    playAlertSound(request.soundType || 'alert');
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'CHECK_COOKIES') {
    getBybitSessionStatus().then(session => sendResponse({ session }));
    return true;
  }
});
