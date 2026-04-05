const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');

const AM   = require('./src/accountManager');
const MFP  = require('./src/maFileParser');
const TE   = require('./src/tradeExecutor');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1380,
        height: 1150,
        minWidth: 1000,
        minHeight: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        backgroundColor: '#0d0d12',
        title: 'GMT Looter'
    });
    mainWindow.loadFile('renderer/index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

function sendLog(msg, level = '') {
    if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('log', msg, level);
}

// ─── Внешние ссылки ──────────────────────────────────────────────────────────

ipcMain.handle('open-external', (_, url) => shell.openExternal(url));

// ─── Группы ──────────────────────────────────────────────────────────────────

ipcMain.handle('get-groups', () => AM.loadGroups());

ipcMain.handle('create-group', (_, name, proxy) => {
    if (!name || !name.trim()) return { success: false, error: 'Введите название' };
    try   { return { success: true, groups: AM.createGroup(name, proxy) }; }
    catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('delete-group', (_, id) => {
    try   { return { success: true, groups: AM.deleteGroup(id) }; }
    catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('rename-group', (_, id, name) => {
    if (!name || !name.trim()) return { success: false, error: 'Введите название' };
    try   { return { success: true, groups: AM.renameGroup(id, name) }; }
    catch (e) { return { success: false, error: e.message }; }
});

// ─── Импорт TXT ──────────────────────────────────────────────────────────────

ipcMain.handle('import-txt', async (_, groupId, type) => {
    const label = type === 'farming' ? 'фарм аккаунтов' : 'хранилища';
    const result = await dialog.showOpenDialog(mainWindow, {
        title: `Выбрать TXT с аккаунтами ${label}`,
        filters: [{ name: 'Text Files', extensions: ['txt'] }],
        properties: ['openFile']
    });
    if (result.canceled) return { success: false };
    try {
        const parsed = AM.parseTxtFile(result.filePaths[0]);
        const groups = AM.importAccounts(groupId, type, parsed);
        return { success: true, groups, count: parsed.length };
    } catch (e) { return { success: false, error: e.message }; }
});

// ─── maFiles ─────────────────────────────────────────────────────────────────

ipcMain.handle('open-mafiles', async (_, groupId, type) => {
    const label = type === 'farming' ? 'фарм аккаунтов' : 'хранилища';
    const result = await dialog.showOpenDialog(mainWindow, {
        title: `Открыть папку maFile ${label}`,
        properties: ['openDirectory']
    });
    if (result.canceled) return { success: false };
    try {
        const maFiles = MFP.scanFolder(result.filePaths[0]);
        const groups  = AM.applyMaFilesToGroup(groupId, type, maFiles);
        const group   = AM.getGroup(groups, groupId);
        const key     = type === 'farming' ? 'farmingAccounts' : 'storageAccounts';
        const matched = (group[key] || []).filter(a => a.maFileFound).length;
        return { success: true, groups, matched, total: maFiles.length };
    } catch (e) { return { success: false, error: e.message }; }
});

// ─── Хранилки: trade URL / выбор ─────────────────────────────────────────────

ipcMain.handle('update-group-proxy', (_, groupId, proxy) => {
    try {
        const groups = AM.updateGroupProxy(groupId, proxy);
        return { success: true, groups };
    } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('update-trade-url', (_, groupId, login, url) => {
    try {
        const groups = AM.updateStorageField(groupId, login, 'tradeUrl', url);
        return { success: true, groups };
    } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('toggle-storage-selected', (_, groupId, login) => {
    try {
        const groups  = AM.loadGroups();
        const group   = AM.getGroup(groups, groupId);
        const acc     = group && group.storageAccounts.find(a => a.login.toLowerCase() === login.toLowerCase());
        if (acc) acc.selected = !acc.selected;
        AM.saveGroups(groups);
        return { success: true, groups };
    } catch (e) { return { success: false, error: e.message }; }
});

// ─── Получить предметы ───────────────────────────────────────────────────────

ipcMain.handle('fetch-items', async (_, groupId) => {
    const groups = AM.loadGroups();
    const group  = AM.getGroup(groups, groupId);
    if (!group) return { success: false, error: 'Группа не найдена' };

    const storageAccounts = group.storageAccounts
        .filter(a => a.selected && a.maFileFound && a.sharedSecret && a.identitySecret);

    if (!storageAccounts.length)
        return { success: false, error: 'Нет готовых хранилок (maFile обязателен)' };

    const itemsByAccount = {};
    for (const acc of storageAccounts) {
        try {
            sendLog(`[${acc.login}] Получение инвентаря...`, 'info');
            itemsByAccount[acc.login] = await TE.fetchStorageItems(acc, sendLog, null);
            sendLog(`[${acc.login}] Найдено: ${itemsByAccount[acc.login].length} предм.`, 'success');
        } catch (err) {
            sendLog(`[${acc.login}] Ошибка: ${err.message}`, 'error');
            itemsByAccount[acc.login] = [];
        }
    }
    return { success: true, items: itemsByAccount };
});

// ─── Создать трейды ──────────────────────────────────────────────────────────

ipcMain.handle('delete-accounts', (_, groupId, type, logins) => {
    try {
        const groups = AM.loadGroups();
        const group  = AM.getGroup(groups, groupId);
        if (!group) return { success: false, error: 'Группа не найдена' };
        const key    = type === 'farming' ? 'farmingAccounts' : 'storageAccounts';
        const set    = new Set(logins.map(l => l.toLowerCase()));
        group[key]   = group[key].filter(a => !set.has(a.login.toLowerCase()));
        AM.saveGroups(groups);
        return { success: true, groups };
    } catch (e) { return { success: false, error: e.message }; }
});

// ─── Сохранить выбор скинов для группы ──────────────────────────────────────

ipcMain.handle('save-item-selection', (_, groupId, names, dividedByTwo) => {
    try {
        const groups = AM.saveItemSelection(groupId, names, dividedByTwo);
        return { success: true, groups };
    } catch (e) { return { success: false, error: e.message }; }
});

// ─── Запуск всех папок ───────────────────────────────────────────────────────

ipcMain.handle('run-all-groups', async () => {
    const groups = AM.loadGroups();
    let totalOk = 0, totalFail = 0, skipped = 0;

    for (const group of groups) {
        const farming = group.farmingAccounts
            .filter(a => a.maFileFound && a.sharedSecret && a.identitySecret);
        const storage = group.storageAccounts
            .filter(a => a.selected && a.maFileFound && a.sharedSecret && a.identitySecret && a.tradeUrl);

        if (!farming.length || !storage.length) {
            sendLog(`[${group.name}] Пропуск — нет готовых аккаунтов`, 'warning');
            skipped++;
            continue;
        }

        const proxy      = group.proxy || null;
        const savedNames = group.savedItemNames || [];

        if (savedNames.length) {
            // Безопасный обмен с залогом
            sendLog(`\n▶ Папка: ${group.name} · ${farming.length} фармилок · ${storage.length} хранилок · ${savedNames.length} типов скинов (с залогом)`, 'info');
            const nameSet      = new Set(savedNames);
            const dividedByTwo = group.dividedByTwo !== false;
            try {
                const r = await TE.executeTrades(storage, farming, dividedByTwo, nameSet, proxy, sendLog);
                totalOk   += r.successful;
                totalFail += r.failed;
            } catch (e) {
                sendLog(`[${group.name}] Критическая ошибка: ${e.message}`, 'error');
            }
        } else {
            // Прямой сбор без залога
            sendLog(`\n▶ Папка: ${group.name} · ${farming.length} фармилок · ${storage.length} хранилок · прямой сбор (без залога)`, 'info');
            try {
                const r = await TE.executeDirectCollect(storage, farming, proxy, sendLog);
                totalOk   += r.successful;
                totalFail += r.failed;
            } catch (e) {
                sendLog(`[${group.name}] Критическая ошибка: ${e.message}`, 'error');
            }
        }
    }

    const msg = `══ Готово: ${totalOk} успешно, ${totalFail} ошибок, ${skipped} папок пропущено ══`;
    sendLog(msg, totalFail > 0 ? 'warning' : 'success');
    return { success: true, successful: totalOk, failed: totalFail, skipped };
});

// ─── Прямой сбор без залога ──────────────────────────────────────────────────

ipcMain.handle('collect-direct', async (_, groupId) => {
    const groups = AM.loadGroups();
    const group  = AM.getGroup(groups, groupId);
    if (!group) return { success: false, error: 'Группа не найдена' };

    const farmingAccounts = group.farmingAccounts
        .filter(a => a.maFileFound && a.sharedSecret && a.identitySecret);
    const storageAccounts = group.storageAccounts
        .filter(a => a.selected && a.maFileFound && a.sharedSecret && a.identitySecret && a.tradeUrl);

    if (!farmingAccounts.length) return { success: false, error: 'Нет фармилок с maFile' };
    if (!storageAccounts.length) return { success: false, error: 'Нет хранилок с maFile + Trade URL' };

    const proxy = group.proxy || null;
    sendLog(`[${group.name}] Прямой сбор: ${farmingAccounts.length} фармилок → ${storageAccounts.length} хранилок${proxy ? ' · прокси: ' + proxy : ''}`, 'info');

    try {
        const result = await TE.executeDirectCollect(storageAccounts, farmingAccounts, proxy, sendLog);
        return { success: true, ...result };
    } catch (e) {
        sendLog(`Критическая ошибка: ${e.message}`, 'error');
        return { success: false, error: e.message };
    }
});

// ─── Создать трейды ──────────────────────────────────────────────────────────

ipcMain.handle('create-trades', async (_, groupId, dividedByTwo, selectedNames) => {
    const groups = AM.loadGroups();
    const group  = AM.getGroup(groups, groupId);
    if (!group) return { success: false, error: 'Группа не найдена' };

    const farmingAccounts = group.farmingAccounts
        .filter(a => a.maFileFound && a.sharedSecret && a.identitySecret);
    const storageAccounts = group.storageAccounts
        .filter(a => a.selected && a.maFileFound && a.sharedSecret && a.identitySecret && a.tradeUrl);

    if (!farmingAccounts.length) return { success: false, error: 'Нет фармилок с maFile' };
    if (!storageAccounts.length) return { success: false, error: 'Нет хранилок с maFile + Trade URL' };

    const nameSet = new Set(Array.isArray(selectedNames) ? selectedNames : []);
    const proxy   = group.proxy || null;
    sendLog(`[${group.name}] ${farmingAccounts.length} фармилок · ${storageAccounts.length} хранилок · ${nameSet.size} типов${proxy ? ' · прокси: ' + proxy : ''}`, 'info');

    try {
        const result = await TE.executeTrades(storageAccounts, farmingAccounts, dividedByTwo, nameSet, proxy, sendLog);
        return { success: true, ...result };
    } catch (e) {
        sendLog(`Критическая ошибка: ${e.message}`, 'error');
        return { success: false, error: e.message };
    }
});
