/* globals api */

// ─── Тема ────────────────────────────────────────────────────────────────────

(function initTheme() {
    const saved = localStorage.getItem('theme');
    if (saved === 'light') document.body.classList.add('theme-light');
    else if (saved === 'grey') document.body.classList.add('theme-grey');
    updateThemeIcon();
})();

function updateThemeIcon() {
    const btn = document.getElementById('btn-theme');
    if (!btn) return;
    if (document.body.classList.contains('theme-light'))     btn.textContent = '☀️';
    else if (document.body.classList.contains('theme-grey')) btn.textContent = '🌫️';
    else                                                     btn.textContent = '🌙';
}

// ─── Ссылки разработчиков ────────────────────────────────────────────────────

document.getElementById('link-nasty').addEventListener('click', () =>
    api.openExternal('https://t.me/nasty_trade'));
document.getElementById('link-disa').addEventListener('click', () =>
    api.openExternal('https://t.me/DisaCashin'));

document.getElementById('btn-theme').addEventListener('click', () => {
    const isLight = document.body.classList.contains('theme-light');
    const isGrey  = document.body.classList.contains('theme-grey');
    document.body.classList.remove('theme-light', 'theme-grey');

    let next;
    if (!isLight && !isGrey)  { document.body.classList.add('theme-grey');  next = 'grey';  }
    else if (isGrey)          { document.body.classList.add('theme-light'); next = 'light'; }
    else                      {                                              next = 'dark';  }

    localStorage.setItem('theme', next);
    updateThemeIcon();
});

// ─── Состояние ───────────────────────────────────────────────────────────────

const state = {
    groups:        [],
    activeGroupId: null,
    storageItems:  {},
    selectedNames: new Set(),
    dividedByTwo:  true,
    busy:          false
};

// Аккаунты, выбранные для удаления (сбрасывается при смене группы)
const delSel = { farming: new Set(), storage: new Set() };

// ─── Инициализация ───────────────────────────────────────────────────────────

(async () => {
    state.groups = await api.getGroups();
    if (state.groups.length) state.activeGroupId = state.groups[0].id;
    renderGroups();
    renderActiveGroup();
    renderProxyField();
})();

api.onLog((msg, level) => log(msg, level));

function activeGroup() {
    return state.groups.find(g => g.id === state.activeGroupId) || null;
}

// ─── Создание папки (inline форма) ───────────────────────────────────────────

document.getElementById('btn-new-group').addEventListener('click', () => {
    const form  = document.getElementById('group-create-form');
    const input = document.getElementById('group-create-input');
    form.classList.remove('hidden');
    input.value = '';
    input.focus();
});

async function commitGroupCreate() {
    const nameInput  = document.getElementById('group-create-input');
    const proxyInput = document.getElementById('group-create-proxy');
    const name  = nameInput.value.trim();
    const proxy = proxyInput.value.trim();
    if (!name) { cancelGroupCreate(); return; }

    const r = await api.createGroup(name, proxy);
    if (!r.success) { log(r.error, 'error'); return; }
    state.groups        = r.groups;
    state.activeGroupId = r.groups[r.groups.length - 1].id;
    resetForGroupSwitch();
    cancelGroupCreate();
    renderGroups();
    renderActiveGroup();
    renderProxyField();
    if (proxy) log(`Папка «${name}» создана с прокси: ${proxy}`, 'success');
    else       log(`Папка «${name}» создана`, 'success');
}

function cancelGroupCreate() {
    document.getElementById('group-create-form').classList.add('hidden');
    document.getElementById('group-create-input').value = '';
    document.getElementById('group-create-proxy').value = '';
}

document.getElementById('group-create-confirm').addEventListener('click', commitGroupCreate);
document.getElementById('group-create-cancel').addEventListener('click', cancelGroupCreate);
document.getElementById('group-create-input').addEventListener('keydown', e => {
    if (e.key === 'Enter')  commitGroupCreate();
    if (e.key === 'Escape') cancelGroupCreate();
});
document.getElementById('group-create-proxy').addEventListener('keydown', e => {
    if (e.key === 'Enter')  commitGroupCreate();
    if (e.key === 'Escape') cancelGroupCreate();
});

// ─── Прокси ──────────────────────────────────────────────────────────────────

const proxyInput = document.getElementById('proxy-input');

// Обновляем поле прокси при смене группы
function renderProxyField() {
    const group = activeGroup();
    const val   = group?.proxy || '';
    proxyInput.value = val;
    proxyInput.classList.toggle('has-proxy', !!val);
}

// Сохраняем прокси при потере фокуса или Enter
proxyInput.addEventListener('blur', saveProxy);
proxyInput.addEventListener('keydown', e => { if (e.key === 'Enter') proxyInput.blur(); });

async function saveProxy() {
    if (!state.activeGroupId) return;
    const val = proxyInput.value.trim();
    const r   = await api.updateGroupProxy(state.activeGroupId, val);
    if (!r.success) { log(r.error, 'error'); return; }
    state.groups = r.groups;
    proxyInput.classList.toggle('has-proxy', !!val);
    if (val) log(`Прокси сохранён: ${val}`, 'success');
}

// ─── Список групп ────────────────────────────────────────────────────────────

function renderGroups() {
    const list = document.getElementById('groups-list');
    list.innerHTML = '';

    if (!state.groups.length) {
        list.innerHTML = '<div class="empty">Нет папок</div>';
        return;
    }

    for (const group of state.groups) {
        const isActive   = group.id === state.activeGroupId;
        const farmCount  = (group.farmingAccounts || []).length;
        const storeCount = (group.storageAccounts || []).length;
        const hasSaved   = (group.savedItemNames || []).length > 0;

        const item = document.createElement('div');
        item.className = `group-item${isActive ? ' active' : ''}`;
        item.dataset.id = group.id;
        item.innerHTML = `
            <span class="group-icon">📁</span>
            <span class="group-name" title="Двойной клик — переименовать">${esc(group.name)}</span>
            ${hasSaved ? `<span class="group-saved-dot" title="${(group.savedItemNames||[]).length} скинов сохранено"></span>` : ''}
            <span class="group-stats">${farmCount}/${storeCount}</span>
            <button class="group-rename" title="Переименовать">✏️</button>
            ${group.id !== 'default'
                ? `<button class="group-del" title="Удалить">✕</button>`
                : ''}
        `;

        // Клик → выбрать группу
        item.addEventListener('click', e => {
            if (e.target.classList.contains('group-del'))    return;
            if (e.target.classList.contains('group-rename')) return;
            if (e.target.classList.contains('group-name-input')) return;
            selectGroup(group.id);
        });

        // Двойной клик на название → переименовать
        item.querySelector('.group-name').addEventListener('dblclick', e => {
            e.stopPropagation();
            startRenameGroup(item, group.id, group.name);
        });

        // Кнопка переименования
        item.querySelector('.group-rename').addEventListener('click', e => {
            e.stopPropagation();
            startRenameGroup(item, group.id, group.name);
        });

        // Удалить
        item.querySelector('.group-del')?.addEventListener('click', e => {
            e.stopPropagation();
            if (!confirm(`Удалить папку «${group.name}»?\nВсе аккаунты внутри будут удалены.`)) return;
            api.deleteGroup(group.id).then(r => {
                if (!r.success) { log(r.error, 'error'); return; }
                state.groups = r.groups;
                if (state.activeGroupId === group.id) {
                    state.activeGroupId = state.groups[0]?.id || null;
                    resetForGroupSwitch();
                }
                renderGroups();
                renderActiveGroup();
            });
        });

        list.appendChild(item);
    }
}

function selectGroup(id) {
    state.activeGroupId = id;
    resetForGroupSwitch();

    // Синхронизировать toggleDiv2 с настройкой группы
    const g = state.groups.find(x => x.id === id);
    if (g) {
        state.dividedByTwo = g.dividedByTwo !== false;
        document.getElementById('toggle-div2').checked = state.dividedByTwo;
    }

    renderGroups();
    renderActiveGroup();
    renderProxyField();
    renderItems();
    updateStats();
}

function resetForGroupSwitch() {
    state.storageItems  = {};
    state.selectedNames = new Set();
    delSel.farming.clear();
    delSel.storage.clear();
    document.getElementById('btn-create-trades').disabled = true;
    updateDelButtons();
}

function startRenameGroup(item, id, currentName) {
    const nameEl = item.querySelector('.group-name');
    const input  = document.createElement('input');
    input.className = 'group-name-input';
    input.value     = currentName;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    const commit = async () => {
        const newName = input.value.trim();
        if (!newName || newName === currentName) { renderGroups(); return; }
        const r = await api.renameGroup(id, newName);
        if (!r.success) { log(r.error, 'error'); renderGroups(); return; }
        state.groups = r.groups;
        renderGroups();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter')  input.blur();
        if (e.key === 'Escape') { input.value = currentName; renderGroups(); }
    });
}

// ─── Отрисовка активной группы ───────────────────────────────────────────────

function renderActiveGroup() {
    const group = activeGroup();
    renderFarming(group);
    renderStorage(group);
}

// ─── Фармилки ────────────────────────────────────────────────────────────────

document.getElementById('btn-import-farming-txt').addEventListener('click', async () => {
    if (!state.activeGroupId) { log('Выберите папку', 'warning'); return; }
    const r = await api.importTxt(state.activeGroupId, 'farming');
    if (!r.success) { if (r.error) log(r.error, 'error'); return; }
    state.groups = r.groups;
    renderGroups();
    renderActiveGroup();
    log(`Импортировано ${r.count} фарм аккаунтов → «${activeGroup()?.name}»`, 'success');
});

document.getElementById('btn-open-farming-mafiles').addEventListener('click', async () => {
    if (!state.activeGroupId) { log('Выберите папку', 'warning'); return; }
    const r = await api.openMaFiles(state.activeGroupId, 'farming');
    if (!r.success) { if (r.error) log(r.error, 'error'); return; }
    state.groups = r.groups;
    renderGroups();
    renderActiveGroup();
    log(`maFile фарм аккаунтов: совпало ${r.matched} из ${r.total}`, 'success');
});

document.getElementById('btn-delete-farming').addEventListener('click', async () => {
    if (!delSel.farming.size) return;
    const logins = [...delSel.farming];
    if (!confirm(`Удалить ${logins.length} фарм аккаунтов?`)) return;
    const r = await api.deleteAccounts(state.activeGroupId, 'farming', logins);
    if (!r.success) { log(r.error, 'error'); return; }
    state.groups = r.groups;
    delSel.farming.clear();
    renderGroups();
    renderActiveGroup();
    updateDelButtons();
    log(`Удалено ${logins.length} фарм аккаунтов`, 'success');
});

function renderFarming(group) {
    const list     = document.getElementById('farming-list');
    const accounts = group?.farmingAccounts || [];
    document.getElementById('farming-count').textContent = accounts.length;

    if (!group)            { list.innerHTML = '<div class="empty">Выберите папку слева</div>'; return; }
    if (!accounts.length)  { list.innerHTML = '<div class="empty">Нет фарм аккаунтов</div>'; return; }

    list.innerHTML = '';
    for (const acc of accounts) {
        const isDelSel = delSel.farming.has(acc.login.toLowerCase());
        const row = document.createElement('div');
        row.className = `account-row${isDelSel ? ' del-selected' : ''}`;
        row.innerHTML = `
            <span class="acc-login">${esc(acc.login)}</span>
            <span class="pill ${acc.maFileFound ? 'pill-ok' : 'pill-miss'}">
                ${acc.maFileFound ? 'maFile ✓' : 'maFile ✗'}
            </span>
        `;
        row.addEventListener('click', () => {
            toggleDelSel('farming', acc.login);
            renderFarming(activeGroup());
            updateDelButtons();
        });
        list.appendChild(row);
    }
}

// ─── Хранилки ────────────────────────────────────────────────────────────────

document.getElementById('btn-import-storage-txt').addEventListener('click', async () => {
    if (!state.activeGroupId) { log('Выберите папку', 'warning'); return; }
    const r = await api.importTxt(state.activeGroupId, 'storage');
    if (!r.success) { if (r.error) log(r.error, 'error'); return; }
    state.groups = r.groups;
    renderGroups();
    renderActiveGroup();
    log(`Импортировано ${r.count} аккаунтов хранилища → «${activeGroup()?.name}»`, 'success');
});

document.getElementById('btn-open-storage-mafiles').addEventListener('click', async () => {
    if (!state.activeGroupId) { log('Выберите папку', 'warning'); return; }
    const r = await api.openMaFiles(state.activeGroupId, 'storage');
    if (!r.success) { if (r.error) log(r.error, 'error'); return; }
    state.groups = r.groups;
    renderGroups();
    renderActiveGroup();
    log(`maFile хранилища: совпало ${r.matched} из ${r.total}`, 'success');
});

document.getElementById('btn-delete-storage').addEventListener('click', async () => {
    if (!delSel.storage.size) return;
    const logins = [...delSel.storage];
    if (!confirm(`Удалить ${logins.length} аккаунтов хранилища?`)) return;
    const r = await api.deleteAccounts(state.activeGroupId, 'storage', logins);
    if (!r.success) { log(r.error, 'error'); return; }
    state.groups = r.groups;
    delSel.storage.clear();
    renderGroups();
    renderActiveGroup();
    updateDelButtons();
    log(`Удалено ${logins.length} аккаунтов хранилища`, 'success');
});

function renderStorage(group) {
    const list     = document.getElementById('storage-list');
    const accounts = group?.storageAccounts || [];
    document.getElementById('storage-count').textContent = accounts.length;

    if (!group)           { list.innerHTML = '<div class="empty">Выберите папку слева</div>'; return; }
    if (!accounts.length) { list.innerHTML = '<div class="empty">Нет аккаунтов хранилища</div>'; return; }

    list.innerHTML = '';
    for (const acc of accounts) {
        const isDelSel = delSel.storage.has(acc.login.toLowerCase());
        const row = document.createElement('div');
        row.className = `account-row${isDelSel ? ' del-selected' : ''}`;
        row.innerHTML = `
            <input  type="checkbox" class="acc-check storage-cb"
                    data-login="${esc(acc.login)}"
                    ${acc.selected ? 'checked' : ''}
                    title="Использовать в трейде">
            <span class="acc-login">${esc(acc.login)}</span>
            <span class="pill ${acc.maFileFound ? 'pill-ok' : 'pill-miss'}">
                ${acc.maFileFound ? '✓' : '✗'}
            </span>
            ${acc.itemsCount !== undefined
                ? `<span class="pill pill-neutral">${acc.itemsCount}</span>`
                : ''}
            <input  type="text" class="trade-url-field storage-url"
                    data-login="${esc(acc.login)}"
                    placeholder="Trade URL..."
                    value="${esc(acc.tradeUrl || '')}">
        `;

        // Клик по строке (не по чекбоксу/инпуту) → выделение для удаления
        row.addEventListener('click', e => {
            if (e.target.tagName === 'INPUT') return;
            toggleDelSel('storage', acc.login);
            renderStorage(activeGroup());
            updateDelButtons();
        });

        row.querySelector('.storage-cb').addEventListener('change', async e => {
            const r = await api.toggleStorageSelected(state.activeGroupId, e.target.dataset.login);
            if (r.success) state.groups = r.groups;
        });

        row.querySelector('.storage-url').addEventListener('blur', async e => {
            const r = await api.updateTradeUrl(state.activeGroupId, e.target.dataset.login, e.target.value.trim());
            if (r.success) state.groups = r.groups;
        });

        list.appendChild(row);
    }
}

// ─── Выделение для удаления ──────────────────────────────────────────────────

function toggleDelSel(type, login) {
    const key = login.toLowerCase();
    if (delSel[type].has(key)) delSel[type].delete(key);
    else delSel[type].add(key);
}

function updateDelButtons() {
    const fBtn = document.getElementById('btn-delete-farming');
    const sBtn = document.getElementById('btn-delete-storage');
    const fCnt = document.getElementById('farming-del-count');
    const sCnt = document.getElementById('storage-del-count');

    const fc = delSel.farming.size;
    const sc = delSel.storage.size;

    fCnt.textContent = fc;
    sCnt.textContent = sc;
    fBtn.classList.toggle('hidden', fc === 0);
    sBtn.classList.toggle('hidden', sc === 0);
}

// ─── Тоггл «делить на 2» ─────────────────────────────────────────────────────

document.getElementById('toggle-div2').addEventListener('change', e => {
    state.dividedByTwo = e.target.checked;
    updateStats();
});

// ─── Получить предметы ───────────────────────────────────────────────────────

document.getElementById('btn-fetch-items').addEventListener('click', async () => {
    if (!state.activeGroupId) { log('Выберите папку', 'warning'); return; }
    const group = activeGroup();

    const selected = (group?.storageAccounts || []).filter(a => a.selected);
    if (!selected.length) { log('Нет выбранных аккаунтов хранилища', 'warning'); return; }

    const noMaFile = selected.filter(a => !a.maFileFound);
    if (noMaFile.length) { log(`Нет maFile: ${noMaFile.map(a => a.login).join(', ')}`, 'error'); return; }

    setBusy(true);
    const btn = document.getElementById('btn-fetch-items');
    btn.textContent = 'Загрузка...';

    const r = await api.fetchItems(state.activeGroupId);

    setBusy(false);
    btn.textContent = 'Получить предметы';

    if (!r.success) { log(r.error, 'error'); return; }

    state.storageItems  = r.items;
    state.selectedNames = new Set();

    const g = activeGroup();
    if (g) {
        for (const acc of g.storageAccounts) {
            acc.itemsCount = (r.items[acc.login] || []).length;
        }
    }

    renderStorage(activeGroup());
    renderItems();
    updateStats();
    document.getElementById('btn-create-trades').disabled = false;
    document.getElementById('btn-save-selection').disabled = false;

    // Восстановить ранее сохранённый выбор скинов для этой группы
    const saved = activeGroup()?.savedItemNames || [];
    if (saved.length) {
        state.selectedNames = new Set(saved);
        renderItems();
        updateStats();
        log(`Восстановлен сохранённый выбор: ${saved.length} типов скинов`, 'info');
    }
});

// ─── Сохранить выбор скинов ──────────────────────────────────────────────────

document.getElementById('btn-save-selection').addEventListener('click', async () => {
    if (!state.activeGroupId) return;
    if (!state.selectedNames.size) { log('Сначала выбери скины', 'warning'); return; }

    const r = await api.saveItemSelection(
        state.activeGroupId,
        [...state.selectedNames],
        state.dividedByTwo
    );
    if (!r.success) { log(r.error, 'error'); return; }
    state.groups = r.groups;
    renderGroups(); // обновит зелёную точку у папки
    log(`✓ Выбор сохранён для «${activeGroup()?.name}»: ${state.selectedNames.size} типов скинов`, 'success');
});

// ─── Прямой сбор без залога ──────────────────────────────────────────────────

document.getElementById('btn-collect-direct').addEventListener('click', async () => {
    if (!state.activeGroupId) { log('Выберите папку', 'warning'); return; }
    const group = activeGroup();

    const farmReady  = (group?.farmingAccounts || []).filter(a => a.maFileFound);
    const storeReady = (group?.storageAccounts || []).filter(a => a.selected && a.tradeUrl && a.maFileFound);
    if (!farmReady.length)  { log('Нет фарм аккаунтов с maFile', 'error'); return; }
    if (!storeReady.length) { log('Нет аккаунтов хранилища с maFile и Trade URL', 'error'); return; }

    if (!confirm(`Собрать предметы с ${farmReady.length} фарм аккаунтов без залога?\n\nФарм аккаунты отдадут весь инвентарь хранилищу. Хранилище ничего не даст взамен.`)) return;

    setBusy(true);
    const btn = document.getElementById('btn-collect-direct');
    btn.textContent = '⏳ Сбор...';

    log('─────────────────────────────────', 'info');
    log(`[${group.name}] Прямой сбор: ${farmReady.length} фарм → ${storeReady.length} хранилищ`, 'info');

    const r = await api.collectDirect(state.activeGroupId);

    setBusy(false);
    btn.textContent = '⬇ Собрать без залога';

    if (r.success) {
        log(`Сбор завершён: ${r.successful} успешно, ${r.failed} ошибок`,
            r.failed > 0 ? 'warning' : 'success');
    } else {
        log(`Ошибка: ${r.error}`, 'error');
    }
});

// ─── Запустить все папки ─────────────────────────────────────────────────────

document.getElementById('btn-run-all').addEventListener('click', async () => {
    const readyGroups = state.groups.filter(g => {
        const farmReady  = (g.farmingAccounts  || []).some(a => a.maFileFound);
        const storeReady = (g.storageAccounts  || []).some(a => a.selected && a.tradeUrl && a.maFileFound);
        return farmReady && storeReady;
    });
    if (!readyGroups.length) {
        log('Нет готовых папок. Нужны фарм аккаунты и хранилка с maFile + Trade URL.', 'warning');
        return;
    }

    const withSel    = readyGroups.filter(g => (g.savedItemNames || []).length > 0).length;
    const withDirect = readyGroups.length - withSel;
    let confirmMsg   = `Запустить для ${readyGroups.length} папок?`;
    if (withSel)    confirmMsg += `\n• ${withSel} папок — с залогом (сохранённые скины)`;
    if (withDirect) confirmMsg += `\n• ${withDirect} папок — без залога (прямой сбор)`;
    if (readyGroups.length < state.groups.length)
        confirmMsg += `\n\nПропущено: ${state.groups.length - readyGroups.length} папок (нет готовых аккаунтов).`;

    if (!confirm(confirmMsg)) return;

    setBusy(true);
    document.getElementById('btn-run-all').textContent = '⏳ Выполняется...';

    log('══════════════════════════════════', 'info');
    log(`▶ Запуск всех папок (${readyGroups.length} из ${state.groups.length})`, 'info');

    const r = await api.runAllGroups();

    setBusy(false);
    document.getElementById('btn-run-all').textContent = '▶ Все папки';

    if (r.success) {
        log(`══ Готово: ${r.successful} успешно · ${r.failed} ошибок · ${r.skipped} пропущено ══`,
            r.failed > 0 ? 'warning' : 'success');
    } else {
        log(`Ошибка: ${r.error}`, 'error');
    }
});

// ─── Создать трейды ──────────────────────────────────────────────────────────

document.getElementById('btn-create-trades').addEventListener('click', async () => {
    if (!state.activeGroupId) return;
    const group = activeGroup();

    const farmReady  = (group?.farmingAccounts || []).filter(a => a.maFileFound);
    const storeReady = (group?.storageAccounts || []).filter(a => a.selected && a.tradeUrl && a.maFileFound);
    if (!farmReady.length)  { log('Нет фарм аккаунтов с maFile', 'error'); return; }
    if (!storeReady.length) { log('Нет аккаунтов хранилища с maFile и Trade URL', 'error'); return; }

    if (!state.selectedNames.size) {
        log('Выдели предметы для трейда (кликни на карточку)', 'warning');
        return;
    }

    setBusy(true);
    const btn = document.getElementById('btn-create-trades');
    btn.textContent = 'Выполняется...';

    log('─────────────────────────────────', 'info');
    log(`[${group.name}] ${farmReady.length} фарм · ${storeReady.length} хранилищ`, 'info');

    const r = await api.createTrades(state.activeGroupId, state.dividedByTwo, [...state.selectedNames]);

    setBusy(false);
    btn.textContent = 'Создать трейды';

    if (r.success) {
        log(`Завершено: ${r.successful} успешно, ${r.failed} ошибок`, r.failed > 0 ? 'warning' : 'success');
    } else {
        log(`Ошибка: ${r.error}`, 'error');
    }
});

// ─── Лог ─────────────────────────────────────────────────────────────────────

document.getElementById('btn-clear-log').addEventListener('click', () => {
    document.getElementById('log-body').innerHTML = '';
});

// ─── Предметы ────────────────────────────────────────────────────────────────

function renderItems() {
    const grid    = document.getElementById('items-grid');
    const typeMap = new Map();

    for (const [login, items] of Object.entries(state.storageItems)) {
        for (const item of items) {
            const key = item.market_hash_name || item.name || '?';
            if (!typeMap.has(key)) typeMap.set(key, { item: { ...item, storageLogin: login }, count: 0 });
            typeMap.get(key).count++;
        }
    }

    if (!typeMap.size) {
        grid.innerHTML = '<div class="empty">Нажмите «Получить предметы»</div>';
        return;
    }

    const hasSelection = state.selectedNames.size > 0;
    const BASE = 'https://community.akamai.steamstatic.com/economy/image/';
    grid.innerHTML = '';

    for (const [key, { item, count }] of typeMap) {
        const isSelected = state.selectedNames.has(key);
        const dimmed     = hasSelection && !isSelected;

        const card = document.createElement('div');
        card.className = `item-card${isSelected ? ' item-selected' : ''}${dimmed ? ' item-dimmed' : ''}`;
        card.title = key;
        card.innerHTML = `
            ${item.icon_url
                ? `<img src="${BASE}${esc(item.icon_url)}/64fx48f" loading="lazy" onerror="this.style.display='none'">`
                : ''}
            <div class="item-card-name">${esc(item.name || key)}</div>
            <div class="item-card-count">${count} шт.</div>
        `;
        card.addEventListener('click', () => {
            if (state.selectedNames.has(key)) state.selectedNames.delete(key);
            else state.selectedNames.add(key);
            renderItems();
            updateStats();
        });
        grid.appendChild(card);
    }
}

// ─── Статистика ──────────────────────────────────────────────────────────────

function updateStats() {
    const statsEl = document.getElementById('items-stats');
    const group   = activeGroup();

    if (!Object.keys(state.storageItems).length) { statsEl.textContent = ''; return; }

    if (!state.selectedNames.size) {
        const types = new Set();
        for (const items of Object.values(state.storageItems))
            items.forEach(i => types.add(i.market_hash_name || i.name || '?'));
        statsEl.textContent = `${types.size} типов — кликни для выбора`;
        return;
    }

    let total = 0, avail = 0;
    for (const items of Object.values(state.storageItems)) {
        const n = items.filter(i => state.selectedNames.has(i.market_hash_name || i.name || '?')).length;
        total  += n;
        avail  += state.dividedByTwo ? Math.floor(n / 2) : n;
    }

    const farmReady = (group?.farmingAccounts || []).filter(a => a.maFileFound).length;
    const trades    = Math.min(avail, farmReady);
    statsEl.textContent = `Выбрано: ${total} предм. · ${avail} доступно · ${farmReady} фарм · ${trades} трейдов`;
}

// ─── Утилиты ─────────────────────────────────────────────────────────────────

function setBusy(val) {
    state.busy = val;
    ['btn-fetch-items','btn-create-trades','btn-collect-direct',
     'btn-import-farming-txt','btn-open-farming-mafiles',
     'btn-import-storage-txt','btn-open-storage-mafiles',
     'btn-new-group'].forEach(id => {
        document.getElementById(id).disabled = val;
    });
}

function log(message, level = '') {
    const el   = document.getElementById('log-body');
    const line = document.createElement('div');
    line.className = `log-line ${level}`;
    const t = new Date().toLocaleTimeString('ru-RU', { hour12: false });
    line.textContent = `[${t}] ${message}`;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
}

function esc(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
