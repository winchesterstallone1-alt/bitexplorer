// popup.js - Controller for Bybit P2P Radar popup interface
let currentSettings = null;
let pollStateInterval = null;

document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  initEventListeners();
  await loadState();

  // Periodic poll for UI updates while popup is open
  pollStateInterval = setInterval(loadState, 2000);
});

window.addEventListener('unload', () => {
  if (pollStateInterval) clearInterval(pollStateInterval);
});

/* Tabs Navigation */
function initTabs() {
  const tabs = document.querySelectorAll('.tab-item');
  const panes = document.querySelectorAll('.tab-pane');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.getAttribute('data-tab');
      tabs.forEach(t => t.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.classList.add('active');
    });
  });
}

/* Event Listeners Setup */
function initEventListeners() {
  // Master Switch Toggle
  const toggleBtn = document.getElementById('toggleMonitoring');
  toggleBtn.addEventListener('change', async () => {
    const isChecked = toggleBtn.checked;
    updateMonitoringStatusUI(isChecked);

    const action = isChecked ? 'START_MONITORING' : 'STOP_MONITORING';
    chrome.runtime.sendMessage({ action }, () => {
      loadState();
    });
  });

  // Filters Form Submission
  const filtersForm = document.getElementById('filtersForm');
  filtersForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveFilterSettings();
    showToast('Настройки фильтров сохранены!');
  });

  // Trigger Mode Change
  const triggerModeSelect = document.getElementById('filterTriggerMode');
  triggerModeSelect.addEventListener('change', updateTriggerModeVisibility);

  // Currency Addon Sync
  const fiatSelect = document.getElementById('filterFiat');
  fiatSelect.addEventListener('change', () => {
    const fiat = fiatSelect.value;
    document.getElementById('amountCurrencyAddon').textContent = fiat;
  });

  // Payment All Toggle Helper
  const paymentAll = document.getElementById('paymentAll');
  const paymentCheckboxes = document.querySelectorAll('input[name="payment"]');
  paymentAll.addEventListener('change', () => {
    if (paymentAll.checked) {
      paymentCheckboxes.forEach(cb => cb.checked = false);
    }
  });
  paymentCheckboxes.forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) paymentAll.checked = false;
    });
  });

  // Stop-Words Blacklist Actions
  document.getElementById('addStopWordBtn').addEventListener('click', handleAddStopWord);
  document.getElementById('newStopWordInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddStopWord();
    }
  });
  document.getElementById('resetStopWordsBtn').addEventListener('click', handleResetStopWords);
  document.getElementById('saveBlacklistBtn').addEventListener('click', async () => {
    await saveBlacklistSettings();
    showToast('Правила защиты сохранены!');
  });

  // Alerts Actions
  document.getElementById('testSoundBtn').addEventListener('click', () => {
    const soundType = document.getElementById('alertSoundType').value;
    chrome.runtime.sendMessage({ action: 'TEST_SOUND', soundType });
  });
  document.getElementById('saveAlertsBtn').addEventListener('click', async () => {
    await saveAlertsSettings();
    showToast('Настройки оповещений сохранены!');
  });

  // Clear Matches Feed
  document.getElementById('clearMatchesBtn').addEventListener('click', async () => {
    if (!currentSettings) return;
    currentSettings.recentMatches = [];
    await chrome.storage.local.set({ settings: currentSettings });
    renderMatchesFeed([]);
    updateMatchesCount(0);
  });

  // Bybit P2P External Button
  document.getElementById('openBybitP2pBtn').addEventListener('click', () => {
    const fiat = currentSettings?.fiat || 'RUB';
    const token = currentSettings?.token || 'USDT';
    chrome.tabs.create({ url: `https://www.bybit.com/fiat/otc/trade/buy/${token}/?fiat=${fiat}` });
  });
}

/* Load State from Background & Storage */
async function loadState() {
  chrome.runtime.sendMessage({ action: 'GET_STATE' }, (response) => {
    if (!response) return;

    const { isRunning, settings, lastBenchmarkPrice, lastStatusMessage, session } = response;
    currentSettings = settings;

    // Update Header Status
    updateMonitoringStatusUI(isRunning);

    // Update Cookies Badge
    updateCookieUI(session);

    // Update Metrics
    const fiat = settings.fiat || 'RUB';
    const mPrice = lastBenchmarkPrice ? `${lastBenchmarkPrice} ${fiat}` : '--';
    document.getElementById('marketPriceDisplay').textContent = mPrice;

    // Format Target Threshold
    let thresholdText = '--';
    if (settings.triggerMode === 'fixed_price') {
      thresholdText = `≤ ${settings.fixedTargetPrice || '--'} ${fiat}`;
    } else if (settings.triggerMode === 'discount_percent') {
      thresholdText = `-${settings.minDiscountPercent || '1.5'}% от рынка`;
    } else {
      thresholdText = `-${settings.minDiscountDiff || '1.0'} ${fiat} от рынка`;
    }
    document.getElementById('targetThresholdDisplay').textContent = thresholdText;

    // Format Target Amount
    const amt = settings.targetAmount ? `${settings.targetAmount} ${fiat}` : 'Любая';
    document.getElementById('targetAmountDisplay').textContent = amt;

    // Status Bar
    if (lastStatusMessage) {
      document.getElementById('statusMessage').textContent = lastStatusMessage;
    }

    // Populate Fields (only if active tab is not currently editing to prevent jitter)
    populateFormFields(settings);

    // Render Feed Matches
    const matches = settings.recentMatches || [];
    renderMatchesFeed(matches);
    updateMatchesCount(matches.length);

    // Render Stop Words
    renderStopWords(settings.stopWords || []);
  });
}

function updateMonitoringStatusUI(isRunning) {
  const toggle = document.getElementById('toggleMonitoring');
  const liveDot = document.getElementById('liveDot');
  const badge = document.getElementById('monitorStatusBadge');

  toggle.checked = !!isRunning;
  if (isRunning) {
    liveDot.classList.add('active');
    badge.classList.add('active');
    badge.textContent = 'РАБОТАЕТ';
  } else {
    liveDot.classList.remove('active');
    badge.classList.remove('active');
    badge.textContent = 'ВЫКЛ';
  }
}

function updateCookieUI(session) {
  const indicator = document.getElementById('cookieIndicator');
  const text = document.getElementById('cookieText');

  if (!session) return;

  if (session.connected && session.count > 0) {
    indicator.className = 'cookie-dot ok';
    text.textContent = `Куки Bybit активны (${session.count})`;
  } else {
    indicator.className = 'cookie-dot warn';
    text.textContent = 'Куки Bybit не найдены (откройте bybit.com)';
  }
}

function updateTriggerModeVisibility() {
  const mode = document.getElementById('filterTriggerMode').value;
  document.getElementById('triggerDiffGroup').style.display = mode === 'market_diff' ? 'block' : 'none';
  document.getElementById('triggerPercentGroup').style.display = mode === 'discount_percent' ? 'block' : 'none';
  document.getElementById('triggerFixedGroup').style.display = mode === 'fixed_price' ? 'block' : 'none';
}

function populateFormFields(s) {
  if (!s) return;

  // Don't overwrite if user has focused an input
  if (document.activeElement && document.activeElement.tagName === 'INPUT') {
    return;
  }

  // Tab 2 Filters
  document.getElementById('filterToken').value = s.token || 'USDT';
  document.getElementById('filterFiat').value = s.fiat || 'RUB';
  document.getElementById('amountCurrencyAddon').textContent = s.fiat || 'RUB';
  document.getElementById('filterSide').value = s.side !== undefined ? String(s.side) : '1';
  document.getElementById('filterTargetAmount').value = s.targetAmount || '';
  if (document.getElementById('filterThirdPartyMode')) {
    document.getElementById('filterThirdPartyMode').value = s.thirdPartyMode || 'explicit_only';
  }
  document.getElementById('filterTriggerMode').value = s.triggerMode || 'market_diff';
  document.getElementById('filterMinDiscountDiff').value = s.minDiscountDiff || '1.0';
  document.getElementById('filterMinDiscountPercent').value = s.minDiscountPercent || '1.5';
  document.getElementById('filterFixedTargetPrice').value = s.fixedTargetPrice || '83.00';
  document.getElementById('filterInterval').value = s.intervalSeconds || 5;

  updateTriggerModeVisibility();

  // Payment checkboxes
  const payments = s.paymentMethods || [];
  const paymentAll = document.getElementById('paymentAll');
  if (payments.length === 0) {
    paymentAll.checked = true;
    document.querySelectorAll('input[name="payment"]').forEach(cb => cb.checked = false);
  } else {
    paymentAll.checked = false;
    document.querySelectorAll('input[name="payment"]').forEach(cb => {
      cb.checked = payments.includes(cb.value);
    });
  }

  // Tab 3 Blacklist
  document.getElementById('filterEnableBlacklist').checked = s.enableBlacklist !== false;
  document.getElementById('filterMinOrders').value = s.minOrders !== undefined ? s.minOrders : 15;
  document.getElementById('filterMinRate').value = s.minRate !== undefined ? s.minRate : 85;
  document.getElementById('filterOnlyVerified').checked = !!s.onlyVerified;

  // Tab 4 Alerts
  document.getElementById('alertEnableSound').checked = s.enableSound !== false;
  document.getElementById('alertSoundType').value = s.soundType || 'alert';
  document.getElementById('alertEnablePush').checked = s.enablePush !== false;
  document.getElementById('alertAutoOpenTab').checked = !!s.autoOpenTab;
}

/* Save handlers */
async function saveFilterSettings() {
  if (!currentSettings) return;

  const paymentAll = document.getElementById('paymentAll').checked;
  const selectedPayments = [];
  if (!paymentAll) {
    document.querySelectorAll('input[name="payment"]:checked').forEach(cb => {
      selectedPayments.push(cb.value);
    });
  }

  const updated = {
    ...currentSettings,
    token: document.getElementById('filterToken').value,
    fiat: document.getElementById('filterFiat').value,
    side: document.getElementById('filterSide').value,
    targetAmount: document.getElementById('filterTargetAmount').value.trim(),
    thirdPartyMode: document.getElementById('filterThirdPartyMode') ? document.getElementById('filterThirdPartyMode').value : 'explicit_only',
    paymentMethods: selectedPayments,
    triggerMode: document.getElementById('filterTriggerMode').value,
    minDiscountDiff: document.getElementById('filterMinDiscountDiff').value,
    minDiscountPercent: document.getElementById('filterMinDiscountPercent').value,
    fixedTargetPrice: document.getElementById('filterFixedTargetPrice').value,
    intervalSeconds: parseInt(document.getElementById('filterInterval').value, 10) || 5
  };

  currentSettings = updated;
  await chrome.storage.local.set({ settings: updated });
}

async function saveBlacklistSettings() {
  if (!currentSettings) return;

  const updated = {
    ...currentSettings,
    enableBlacklist: document.getElementById('filterEnableBlacklist').checked,
    minOrders: parseInt(document.getElementById('filterMinOrders').value, 10) || 0,
    minRate: parseFloat(document.getElementById('filterMinRate').value) || 0,
    onlyVerified: document.getElementById('filterOnlyVerified').checked
  };

  currentSettings = updated;
  await chrome.storage.local.set({ settings: updated });
}

async function saveAlertsSettings() {
  if (!currentSettings) return;

  const updated = {
    ...currentSettings,
    enableSound: document.getElementById('alertEnableSound').checked,
    soundType: document.getElementById('alertSoundType').value,
    enablePush: document.getElementById('alertEnablePush').checked,
    autoOpenTab: document.getElementById('alertAutoOpenTab').checked
  };

  currentSettings = updated;
  await chrome.storage.local.set({ settings: updated });
}

/* Stop words UI */
function renderStopWords(words) {
  const container = document.getElementById('stopWordsList');
  const countSpan = document.getElementById('stopWordsCount');
  countSpan.textContent = words.length;

  container.innerHTML = '';
  words.forEach((word, index) => {
    const chip = document.createElement('span');
    chip.className = 'chip-tag';
    chip.innerHTML = `
      <span>${escapeHtml(word)}</span>
      <span class="chip-close" data-index="${index}" title="Удалить">✕</span>
    `;
    chip.querySelector('.chip-close').addEventListener('click', () => {
      removeStopWord(index);
    });
    container.appendChild(chip);
  });
}

async function handleAddStopWord() {
  const input = document.getElementById('newStopWordInput');
  const val = input.value.trim().toLowerCase();
  if (!val || !currentSettings) return;

  const words = currentSettings.stopWords || [];
  if (!words.includes(val)) {
    words.push(val);
    currentSettings.stopWords = words;
    await chrome.storage.local.set({ settings: currentSettings });
    renderStopWords(words);
    input.value = '';
  }
}

async function removeStopWord(index) {
  if (!currentSettings) return;
  const words = currentSettings.stopWords || [];
  words.splice(index, 1);
  currentSettings.stopWords = words;
  await chrome.storage.local.set({ settings: currentSettings });
  renderStopWords(words);
}

async function handleResetStopWords() {
  if (!confirm('Сбросить список стоп-слов к базовым рекомендуемым?')) return;
  const { DEFAULT_STOP_WORDS } = await import('../background/filter-engine.js');
  if (currentSettings) {
    currentSettings.stopWords = [...DEFAULT_STOP_WORDS];
    await chrome.storage.local.set({ settings: currentSettings });
    renderStopWords(currentSettings.stopWords);
    showToast('Список сброшен к базовому');
  }
}

/* Matches Feed Rendering */
function renderMatchesFeed(matches) {
  const container = document.getElementById('feedList');
  const emptyView = document.getElementById('emptyFeed');

  if (!matches || matches.length === 0) {
    emptyView.style.display = 'block';
    Array.from(container.children).forEach(child => {
      if (child.id !== 'emptyFeed') child.remove();
    });
    return;
  }

  emptyView.style.display = 'none';

  const existingCards = container.querySelectorAll('.order-card');
  existingCards.forEach(c => c.remove());

  matches.forEach(item => {
    const card = document.createElement('div');
    card.className = 'order-card promoted';

    const paymentsList = (item.payments || []).map(p => {
      return getPaymentBadgeHtml(p);
    }).join(' ');

    const verifiedBadge = item.authMaker ? '<span class="pro-badge" title="PRO Мерчант">✓ PRO</span>' : '';
    const formattedTime = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const initial = (item.nickName || 'P')[0].toUpperCase();

    const tpChip = item.thirdPartyStatus === 'allowed'
      ? '<span class="tp-chip allowed">👤 3-е лицо РАЗРЕШЕНО</span>'
      : '<span class="tp-chip neutral">⚪ 3-е лицо не указано</span>';

    card.innerHTML = `
      <div class="card-merchant-row">
        <div class="merchant-profile">
          <div class="avatar-circle">${escapeHtml(initial)}</div>
          <div class="merchant-meta">
            <div class="merchant-name">${escapeHtml(item.nickName)} ${verifiedBadge}</div>
            <div class="merchant-rates">${item.executeRate}% выполнено • ${item.orderNum} сделок</div>
          </div>
        </div>
        <span class="card-timestamp">${formattedTime}</span>
      </div>

      <div class="card-price-row">
        <div class="price-main">${item.price} ${item.fiat || 'RUB'}</div>
        <div class="profit-pill">${escapeHtml(item.profitDetails || 'Выгодно')}</div>
      </div>

      <div class="card-third-party-row">
        ${tpChip}
      </div>

      <div class="card-spec-grid">
        <div class="spec-line">Лимиты: <strong>${item.minAmount} - ${item.maxAmount} ${item.fiat || 'RUB'}</strong></div>
        <div class="payments-flow">${paymentsList || '<span class="bank-pill bank-generic">Любой банк</span>'}</div>
      </div>

      ${item.remark ? `<div class="card-remark-box" title="${escapeHtml(item.remark)}">💬 ${escapeHtml(item.remark)}</div>` : ''}

      <button class="btn-cta-buy" data-id="${item.id}" data-token="${item.token || 'USDT'}" data-fiat="${item.fiat || 'RUB'}">
        Забрать ордер на Bybit ↗
      </button>
    `;

    card.querySelector('.btn-cta-buy').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      const adId = btn.getAttribute('data-id');
      const token = btn.getAttribute('data-token');
      const fiat = btn.getAttribute('data-fiat');
      const url = `https://www.bybit.com/fiat/otc/trade/buy/${token}/${adId}?fiat=${fiat}`;
      chrome.tabs.create({ url });
    });

    container.appendChild(card);
  });
}

function updateMatchesCount(count) {
  document.getElementById('matchesCount').textContent = count;
}

function getPaymentBadgeHtml(id) {
  const sId = String(id);
  if (sId === '582' || sId === '64') {
    return '<span class="bank-pill bank-tinkoff">Т-Банк</span>';
  } else if (sId === '581' || sId === '14') {
    return '<span class="bank-pill bank-sber">Сбербанк</span>';
  } else if (sId === '382') {
    return '<span class="bank-pill bank-sbp">СБП</span>';
  } else if (sId === '62') {
    return '<span class="bank-pill bank-raiff">Райффайзен</span>';
  }
  return `<span class="bank-pill bank-generic">Банк #${sId}</span>`;
}

function showToast(msg) {
  const sb = document.getElementById('statusBar');
  const msgEl = document.getElementById('statusMessage');
  const prev = msgEl.textContent;
  msgEl.textContent = `✓ ${msg}`;
  sb.style.borderColor = 'var(--green-buy)';
  setTimeout(() => {
    msgEl.textContent = prev;
    sb.style.borderColor = 'var(--border-subtle)';
  }, 2500);
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
