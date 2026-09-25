// content.js - In-page bridge for Bybit P2P and request proxying

// Listen for proxy requests from background service worker
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'FETCH_P2P_PROXY') {
    fetch(request.endpoint, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.payload),
      credentials: 'include'
    })
      .then(res => res.json())
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.toString() }));
    return true; // asynchronous response
  }

  if (request.action === 'SHOW_PAGE_ALERT') {
    showInPageToast(request.data);
    sendResponse({ success: true });
  }
});

function showInPageToast(data) {
  let toast = document.getElementById('bybit-radar-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'bybit-radar-toast';
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 999999;
      background: linear-gradient(135deg, #181A20 0%, #222631 100%);
      color: #FFFFFF;
      border: 1px solid #F7A600;
      border-radius: 12px;
      padding: 14px 18px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5), 0 0 15px rgba(247,166,0,0.2);
      max-width: 340px;
      transition: all 0.3s ease;
      cursor: pointer;
    `;
    document.body.appendChild(toast);
  }

  toast.innerHTML = `
    <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
      <span style="font-size:18px;">🔥</span>
      <strong style="color:#F7A600; font-size:14px;">Bybit Radar: Выгодный ордер!</strong>
    </div>
    <div style="font-size:16px; font-weight:700; color:#00E676; margin-bottom:4px;">
      ${data.price} ${data.fiat || 'RUB'}
    </div>
    <div style="font-size:12px; color:#A0A5B5; margin-bottom:6px;">
      ${data.profitDetails || ''}
    </div>
    <div style="font-size:11px; color:#E0E3EB;">
      Мерчант: <strong>${data.nickName}</strong> | Лимиты: ${data.minAmount} - ${data.maxAmount}
    </div>
  `;

  toast.onclick = () => {
    if (data.id) {
      window.location.href = `https://www.bybit.com/fiat/otc/trade/buy/${data.token || 'USDT'}/${data.id}?fiat=${data.fiat || 'RUB'}`;
    }
  };

  setTimeout(() => {
    if (toast && toast.parentNode) {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      setTimeout(() => toast.remove(), 400);
    }
  }, 8000);
}
