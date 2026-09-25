// bybit-api.js - API client for Bybit P2P with cookie & session handling

const API_ENDPOINTS = [
  'https://api2.bybit.com/fiat/otc/item/online',
  'https://www.bybit.com/fiat/otc/item/online'
];

/**
 * Checks Bybit session cookies status
 */
export async function getBybitSessionStatus() {
  try {
    const cookies = await chrome.cookies.getAll({ domain: 'bybit.com' });
    if (!cookies || cookies.length === 0) {
      return { connected: false, count: 0, message: 'Куки Bybit не найдены. Войдите на bybit.com' };
    }

    const hasSecureToken = cookies.some(c => c.name.toLowerCase().includes('secure') || c.name.toLowerCase().includes('token'));
    const hasUid = cookies.some(c => c.name.toLowerCase().includes('u_id') || c.name.toLowerCase().includes('user'));
    const hasAkamai = cookies.some(c => c.name.includes('_abck') || c.name.includes('bm_sz'));

    return {
      connected: true,
      count: cookies.length,
      isLoggedIn: hasSecureToken || hasUid,
      hasAkamai,
      message: `Подключено: найдено ${cookies.length} cookies Bybit`
    };
  } catch (err) {
    console.error('[Bybit API] Error checking cookies:', err);
    return { connected: false, count: 0, message: 'Ошибка доступа к cookies' };
  }
}

/**
 * Fetches P2P item listings from Bybit using browser credentials/cookies
 */
export async function fetchP2PItems(settings = {}) {
  const payload = {
    userId: '',
    tokenId: settings.token || 'USDT',
    currencyId: settings.fiat || 'RUB',
    payment: settings.paymentMethods && settings.paymentMethods.length > 0 ? settings.paymentMethods : [],
    side: String(settings.side || '1'), // '1' = Buy crypto (merchants selling), '0' = Sell crypto
    size: '30',
    page: '1',
    amount: settings.targetAmount ? String(settings.targetAmount) : '',
    authMaker: !!settings.onlyVerified,
    canTrade: false
  };

  const headers = {
    'Content-Type': 'application/json;charset=UTF-8',
    'Accept': 'application/json, text/plain, */*',
    'Lang': 'ru-RU',
    'Origin': 'https://www.bybit.com',
    'Referer': 'https://www.bybit.com/'
  };

  let lastError = null;

  // Try direct fetch from background worker with cookies
  for (const endpoint of API_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        credentials: 'include'
      });

      const contentType = response.headers.get('content-type') || '';

      if (response.ok && contentType.includes('application/json')) {
        const data = await response.json();
        if (data && (data.ret_code === 0 || data.retCode === 0) && data.result) {
          return {
            success: true,
            items: data.result.items || [],
            total: data.result.count || 0
          };
        }
      }

      if (response.status === 403 || !contentType.includes('application/json')) {
        lastError = new Error(`Защита Akamai (код ${response.status})`);
      } else {
        lastError = new Error(`Bybit API ошибка: HTTP ${response.status}`);
      }
    } catch (err) {
      lastError = err;
    }
  }

  // Fallback: If background worker fetch is blocked by Akamai, try to proxy via an open Bybit tab!
  try {
    const tabs = await chrome.tabs.query({ url: '*://*.bybit.com/*' });
    if (tabs && tabs.length > 0) {
      const tabId = tabs[0].id;
      const tabResponse = await chrome.tabs.sendMessage(tabId, {
        action: 'FETCH_P2P_PROXY',
        endpoint: API_ENDPOINTS[0],
        payload,
        headers
      });

      if (tabResponse && tabResponse.success && tabResponse.data) {
        const d = tabResponse.data;
        if (d && (d.ret_code === 0 || d.retCode === 0) && d.result) {
          return {
            success: true,
            items: d.result.items || [],
            total: d.result.count || 0,
            viaProxyTab: true
          };
        }
      }
    }
  } catch (proxyErr) {
    console.warn('[Bybit API] Tab proxy fallback failed:', proxyErr);
  }

  return {
    success: false,
    error: lastError ? lastError.message : 'Не удалось получить данные с Bybit P2P',
    items: []
  };
}
