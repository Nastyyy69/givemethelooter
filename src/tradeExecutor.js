const SteamUser = require('steam-user');
const SteamCommunity = require('steamcommunity');
const SteamTotp = require('steam-totp');
const TradeOfferManager = require('steam-tradeoffer-manager');
const { HttpsProxyAgent } = require('https-proxy-agent'); // v5 CommonJS

// ─── Определение кейсов ──────────────────────────────────────────────────────
// Исключаем: оружейные кейсы, сувенирные упаковки и все контейнеры

function isCase(item) {
    // Проверка по полю type
    if (item.type) {
        const t = item.type.toLowerCase();
        if (t.includes('container')) return true;
        if (t.includes('souvenir')) return true;
    }

    // Проверка по тегам
    if (Array.isArray(item.tags)) {
        for (const tag of item.tags) {
            const name = (tag.internal_name || '').toLowerCase();
            if (
                name === 'csgo_type_weaponcase' ||
                name === 'csgo_type_souvenir' ||
                name.includes('container')
            ) return true;
        }
    }

    // Проверка по market_hash_name
    if (item.market_hash_name) {
        const n = item.market_hash_name;
        if (n.endsWith(' Case')) return true;
        if (n.endsWith(' Package')) return true;
    }

    return false;
}

// ─── Нормализация прокси → URL ───────────────────────────────────────────────
// Поддерживаемые форматы:
//   ip:port
//   ip:port:user:pass
//   user:pass@ip:port

function buildProxyUrl(raw) {
    if (!raw || !raw.trim()) return null;
    const s = raw.trim();
    if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('socks')) return s;

    // user:pass@ip:port
    if (s.includes('@')) return `http://${s}`;

    // ip:port:user:pass
    const parts = s.split(':');
    if (parts.length === 4) {
        const [host, port, user, pass] = parts;
        return `http://${user}:${pass}@${host}:${port}`;
    }

    // ip:port
    return `http://${s}`;
}

// ─── Логин в Steam ───────────────────────────────────────────────────────────

function loginToSteam(account, proxy) {
    return new Promise((resolve, reject) => {
        const proxyUrl = buildProxyUrl(proxy);

        const clientOptions = {};
        if (proxyUrl) clientOptions.httpProxy = proxyUrl;

        const client    = new SteamUser(clientOptions);
        const community = new SteamCommunity();
        const manager   = new TradeOfferManager({
            steam: client,
            community: community,
            language: 'en',
            pollInterval: 5000
        });

        // Прокси для HTTP запросов SteamCommunity (торговые офферы, инвентарь)
        if (proxyUrl) {
            try {
                const agent = new HttpsProxyAgent(proxyUrl);
                community._httpRequestDefaults = {
                    ...(community._httpRequestDefaults || {}),
                    agent
                };
            } catch (_) {}
        }

        const logOnOptions = {
            accountName: account.login,
            password: account.password,
            twoFactorCode: SteamTotp.getAuthCode(account.sharedSecret)
        };

        const timeout = setTimeout(() => {
            try { client.logOff(); } catch (_) {}
            reject(new Error(`Таймаут входа: ${account.login}`));
        }, 45000);

        client.logOn(logOnOptions);

        client.once('webSession', (sessionID, cookies) => {
            clearTimeout(timeout);
            manager.setCookies(cookies, err => {
                if (err) {
                    try { client.logOff(); } catch (_) {}
                    return reject(err);
                }
                community.setCookies(cookies);
                resolve({ client, manager, community });
            });
        });

        client.once('error', err => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}

// ─── Получение инвентаря ─────────────────────────────────────────────────────

function getInventory(manager, appId = 730, contextId = 2) {
    return new Promise((resolve, reject) => {
        manager.getInventoryContents(appId, contextId, true, (err, items) => {
            if (err) reject(err);
            else resolve(items);
        });
    });
}

// ─── Отправка трейда ─────────────────────────────────────────────────────────

function sendOffer(offer) {
    return new Promise((resolve, reject) => {
        offer.send((err, status) => {
            if (err) reject(err);
            else resolve({ id: offer.id, status });
        });
    });
}

// ─── Подтверждение через identity_secret ────────────────────────────────────

function confirmObject(community, identitySecret, objectId) {
    return new Promise((resolve, reject) => {
        community.acceptConfirmationForObject(identitySecret, objectId, err => {
            if (err) reject(err);
            else resolve();
        });
    });
}

// ─── Получить активные входящие офферы ──────────────────────────────────────

function getReceivedOffers(manager) {
    return new Promise((resolve, reject) => {
        // EOfferFilter.ActiveOnly = 1
        manager.getOffers(1, null, (err, _sent, received) => {
            if (err) reject(err);
            else resolve(received || []);
        });
    });
}

// ─── Принятие трейда ─────────────────────────────────────────────────────────

function acceptOffer(offer) {
    return new Promise((resolve, reject) => {
        offer.accept(false, (err, status) => {
            if (err) reject(err);
            else resolve(status);
        });
    });
}

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ─── Экспорт: получить предметы хранилки ────────────────────────────────────

async function fetchStorageItems(account, logFn, proxy) {
    const { client, manager } = await loginToSteam(account, proxy);

    let items;
    try {
        items = await getInventory(manager);
    } finally {
        try { client.logOff(); } catch (_) {}
    }

    const nonCases = items.filter(item => !isCase(item));

    return nonCases.map(item => ({
        assetid:          (item.id || item.assetid).toString(),
        market_hash_name: item.market_hash_name || '',
        name:             item.name || item.market_hash_name || 'Unknown',
        icon_url:         item.icon_url || '',
        type:             item.type || ''
    }));
}

// ─── Экспорт: выполнить все трейды ──────────────────────────────────────────

async function executeTrades(storageAccounts, farmingAccounts, dividedByTwo, selectedNames, proxy, logFn) {
    const queue = [...farmingAccounts];
    let totalOk = 0;
    let totalFail = 0;

    if (proxy) logFn(`Прокси: ${proxy}`, 'info');

    for (const storage of storageAccounts) {
        if (queue.length === 0) break;

        logFn(`\n══ Хранилка: ${storage.login} ══`, 'info');

        // Логин в хранилку (хранилки без прокси — они не фармилки)
        let storageSession;
        try {
            logFn(`[${storage.login}] Вход...`);
            storageSession = await loginToSteam(storage, null);
        } catch (err) {
            logFn(`[${storage.login}] Ошибка входа: ${err.message}`, 'error');
            continue;
        }

        const { client: stClient, manager: stManager, community: stCommunity } = storageSession;

        // Свежий инвентарь хранилки
        let storageItems;
        try {
            const all = await getInventory(stManager);
            // Фильтр: не кейсы + только выбранные типы
            storageItems = all.filter(item => {
                if (isCase(item)) return false;
                if (selectedNames && selectedNames.size > 0) {
                    return selectedNames.has(item.market_hash_name || item.name || '?');
                }
                return true;
            });
            logFn(`[${storage.login}] Предметы: ${all.length} всего, ${storageItems.length} выбранных`);
        } catch (err) {
            logFn(`[${storage.login}] Ошибка инвентаря: ${err.message}`, 'error');
            try { stClient.logOff(); } catch (_) {}
            continue;
        }

        const slots = dividedByTwo
            ? Math.floor(storageItems.length / 2)
            : storageItems.length;

        if (slots === 0) {
            logFn(`[${storage.login}] Нет доступных слотов, пропуск`, 'warning');
            try { stClient.logOff(); } catch (_) {}
            continue;
        }

        logFn(`[${storage.login}] Слотов для обмена: ${slots} (÷2: ${dividedByTwo})`);

        // Сопоставление предметов → фармилки
        const assignments = [];
        for (let i = 0; i < slots && queue.length > 0; i++) {
            assignments.push({
                farming: queue.shift(),
                item:    storageItems[i]
            });
        }

        logFn(`[${storage.login}] Обрабатываю ${assignments.length} фармилок`);

        const sentIds = [];

        // Каждая фармилка отправляет трейд
        for (const { farming, item } of assignments) {
            logFn(`  → [${farming.login}] Вход...`);

            let farmSession;
            try {
                farmSession = await loginToSteam(farming, proxy);
            } catch (err) {
                logFn(`  → [${farming.login}] Ошибка входа: ${err.message}`, 'error');
                totalFail++;
                continue;
            }

            const { client: fClient, manager: fManager, community: fCommunity } = farmSession;

            try {
                const farmItems = await getInventory(fManager);

                if (farmItems.length === 0) {
                    logFn(`  → [${farming.login}] Пустой инвентарь, пропуск`, 'warning');
                    try { fClient.logOff(); } catch (_) {}
                    continue;
                }

                logFn(`  → [${farming.login}] ${farmItems.length} предм. → запрашивает "${item.name}"`);

                const offer = fManager.createOffer(storage.tradeUrl);

                // Весь инвентарь фармилки отдаём
                farmItems.forEach(fi => {
                    offer.addMyItem({
                        appid:     fi.appid,
                        contextid: fi.contextid,
                        assetid:   (fi.id || fi.assetid).toString()
                    });
                });

                // Запрашиваем конкретный предмет у хранилки (по assetid)
                offer.addTheirItem({
                    appid:     730,
                    contextid: '2',
                    assetid:   item.assetid.toString()
                });

                const { id: offerId, status } = await sendOffer(offer);
                logFn(`  → [${farming.login}] Оффер #${offerId} отправлен (${status})`);

                // Подтверждение со стороны фармилки
                if (status === 'pending') {
                    try {
                        await confirmObject(fCommunity, farming.identitySecret, offerId);
                        logFn(`  → [${farming.login}] Оффер подтверждён`);
                    } catch (err) {
                        logFn(`  → [${farming.login}] Ошибка подтверждения: ${err.message}`, 'error');
                    }
                }

                sentIds.push(offerId);
                totalOk++;

            } catch (err) {
                logFn(`  → [${farming.login}] Ошибка трейда: ${err.message}`, 'error');
                totalFail++;
            } finally {
                try { fClient.logOff(); } catch (_) {}
                await delay(2000);
            }
        }

        // Хранилка принимает входящие офферы
        if (sentIds.length > 0) {
            logFn(`[${storage.login}] Ожидание офферов (5 сек)...`);
            await delay(5000);

            try {
                const received = await getReceivedOffers(stManager);
                const toAccept = received.filter(o => sentIds.includes(o.id));

                logFn(`[${storage.login}] Принимаю ${toAccept.length} офферов`);

                for (const o of toAccept) {
                    try {
                        const status = await acceptOffer(o);
                        logFn(`[${storage.login}] Принял #${o.id} (${status})`);

                        if (status === 'pending') {
                            await delay(1000);
                            await confirmObject(stCommunity, storage.identitySecret, o.id);
                            logFn(`[${storage.login}] Подтвердил #${o.id}`, 'success');
                        }

                        await delay(1000);
                    } catch (err) {
                        logFn(`[${storage.login}] Ошибка принятия #${o.id}: ${err.message}`, 'error');
                    }
                }
            } catch (err) {
                logFn(`[${storage.login}] Ошибка получения офферов: ${err.message}`, 'error');
            }
        }

        try { stClient.logOff(); } catch (_) {}
        await delay(3000);
    }

    logFn(`\n✓ Готово: ${totalOk} успешно, ${totalFail} ошибок`, totalFail > 0 ? 'warning' : 'success');

    return { successful: totalOk, failed: totalFail };
}

// ─── Прямой сбор без залога ─────────────────────────────────────────────────
// Фармилки отправляют весь инвентарь хранилкам, ничего не запрашивая взамен.
// Хранилки принимают входящие офферы.

async function executeDirectCollect(storageAccounts, farmingAccounts, proxy, logFn) {
    if (!storageAccounts.length) throw new Error('Нет хранилок с Trade URL');
    if (!farmingAccounts.length) throw new Error('Нет фармилок с maFile');

    let totalOk = 0, totalFail = 0;

    if (proxy) logFn(`Прокси: ${proxy}`, 'info');

    // Round-robin: равномерно распределяем фармилки по хранилкам
    const buckets = new Map();
    for (const st of storageAccounts) buckets.set(st.login, { storage: st, farmings: [] });
    farmingAccounts.forEach((farm, i) => {
        const st = storageAccounts[i % storageAccounts.length];
        buckets.get(st.login).farmings.push(farm);
    });

    for (const { storage, farmings } of buckets.values()) {
        if (!farmings.length) continue;

        logFn(`\n══ Хранилка: ${storage.login} · ${farmings.length} фармилок ══`, 'info');

        const sentIds = [];

        for (const farming of farmings) {
            logFn(`  → [${farming.login}] Вход...`);

            let farmSession;
            try {
                farmSession = await loginToSteam(farming, proxy);
            } catch (err) {
                logFn(`  → [${farming.login}] Ошибка входа: ${err.message}`, 'error');
                totalFail++;
                continue;
            }

            const { client: fClient, manager: fManager, community: fCommunity } = farmSession;

            try {
                const farmItems = await getInventory(fManager);

                if (!farmItems.length) {
                    logFn(`  → [${farming.login}] Пустой инвентарь, пропуск`, 'warning');
                    try { fClient.logOff(); } catch (_) {}
                    continue;
                }

                logFn(`  → [${farming.login}] ${farmItems.length} предм. → отправка без залога`);

                const offer = fManager.createOffer(storage.tradeUrl);
                farmItems.forEach(fi => {
                    offer.addMyItem({
                        appid:     fi.appid,
                        contextid: fi.contextid,
                        assetid:   (fi.id || fi.assetid).toString()
                    });
                });

                const { id: offerId, status } = await sendOffer(offer);
                logFn(`  → [${farming.login}] Оффер #${offerId} отправлен (${status})`);

                if (status === 'pending') {
                    try {
                        await confirmObject(fCommunity, farming.identitySecret, offerId);
                        logFn(`  → [${farming.login}] Оффер подтверждён`);
                    } catch (err) {
                        logFn(`  → [${farming.login}] Ошибка подтверждения: ${err.message}`, 'error');
                    }
                }

                sentIds.push(offerId);
                totalOk++;

            } catch (err) {
                logFn(`  → [${farming.login}] Ошибка трейда: ${err.message}`, 'error');
                totalFail++;
            } finally {
                try { fClient.logOff(); } catch (_) {}
                await delay(2000);
            }
        }

        if (!sentIds.length) continue;

        // Хранилка принимает входящие офферы
        logFn(`[${storage.login}] Вход для принятия офферов...`);
        let stSession;
        try {
            stSession = await loginToSteam(storage, null);
        } catch (err) {
            logFn(`[${storage.login}] Ошибка входа хранилки: ${err.message}`, 'error');
            continue;
        }

        const { client: stClient, manager: stManager, community: stCommunity } = stSession;

        logFn(`[${storage.login}] Ожидание офферов (5 сек)...`);
        await delay(5000);

        try {
            const received = await getReceivedOffers(stManager);
            const toAccept = received.filter(o => sentIds.includes(o.id));
            logFn(`[${storage.login}] Принимаю ${toAccept.length} офферов`);

            for (const o of toAccept) {
                try {
                    const status = await acceptOffer(o);
                    logFn(`[${storage.login}] Принял #${o.id} (${status})`);
                    if (status === 'pending') {
                        await delay(1000);
                        await confirmObject(stCommunity, storage.identitySecret, o.id);
                        logFn(`[${storage.login}] Подтвердил #${o.id}`, 'success');
                    }
                    await delay(1000);
                } catch (err) {
                    logFn(`[${storage.login}] Ошибка принятия #${o.id}: ${err.message}`, 'error');
                }
            }
        } catch (err) {
            logFn(`[${storage.login}] Ошибка получения офферов: ${err.message}`, 'error');
        }

        try { stClient.logOff(); } catch (_) {}
        await delay(3000);
    }

    logFn(`\n✓ Прямой сбор завершён: ${totalOk} успешно, ${totalFail} ошибок`,
        totalFail > 0 ? 'warning' : 'success');
    return { successful: totalOk, failed: totalFail };
}

module.exports = { fetchStorageItems, executeTrades, executeDirectCollect, isCase };
