const fs   = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'groups.json');
const DATA_DIR  = path.join(__dirname, '..', 'data');

function ensureDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ─── Группы ──────────────────────────────────────────────────────────────────

function loadGroups() {
    ensureDir();
    if (!fs.existsSync(DATA_FILE)) {
        const def = [{ id: 'default', name: 'Основная группа', farmingAccounts: [], storageAccounts: [] }];
        fs.writeFileSync(DATA_FILE, JSON.stringify(def, null, 2));
        return def;
    }
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch {
        return [];
    }
}

function saveGroups(groups) {
    ensureDir();
    fs.writeFileSync(DATA_FILE, JSON.stringify(groups, null, 2));
}

function getGroup(groups, id) {
    return groups.find(g => g.id === id) || null;
}

function createGroup(name, proxy) {
    const groups = loadGroups();
    const group  = {
        id: generateId(),
        name: name.trim(),
        proxy: proxy ? proxy.trim() : '',
        farmingAccounts: [],
        storageAccounts: []
    };
    groups.push(group);
    saveGroups(groups);
    return groups;
}

function deleteGroup(id) {
    if (id === 'default') throw new Error('Нельзя удалить основную группу');
    const groups = loadGroups().filter(g => g.id !== id);
    saveGroups(groups);
    return groups;
}

function renameGroup(id, name) {
    const groups = loadGroups();
    const g = getGroup(groups, id);
    if (g) g.name = name.trim();
    saveGroups(groups);
    return groups;
}

// ─── Парсинг TXT ─────────────────────────────────────────────────────────────

function parseTxtFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const results = [];
    for (const raw of content.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        const login    = line.slice(0, idx).trim();
        const password = line.slice(idx + 1).trim();
        if (login && password) results.push({ login, password });
    }
    return results;
}

// ─── Импорт аккаунтов в группу ───────────────────────────────────────────────

function importAccounts(groupId, type, newAccounts) {
    const groups = loadGroups();
    const group  = getGroup(groups, groupId);
    if (!group) throw new Error(`Группа не найдена: ${groupId}`);

    const key = type === 'farming' ? 'farmingAccounts' : 'storageAccounts';
    const map = {};
    group[key].forEach(a => { map[a.login.toLowerCase()] = a; });

    newAccounts.forEach(acc => {
        const k = acc.login.toLowerCase();
        if (!map[k]) {
            map[k] = type === 'farming'
                ? { ...acc, maFileFound: false }
                : { ...acc, maFileFound: false, selected: true, tradeUrl: '' };
        } else {
            map[k].password = acc.password;
        }
    });

    group[key] = Object.values(map);
    saveGroups(groups);
    return groups;
}

// ─── maFiles ─────────────────────────────────────────────────────────────────

function mergeMaFiles(accounts, maFiles) {
    const maMap = {};
    for (const mf of maFiles) {
        if (mf.accountName) maMap[mf.accountName.toLowerCase()] = mf;
    }
    return accounts.map(acc => {
        const mf = maMap[acc.login.toLowerCase()];
        if (mf) {
            return { ...acc, sharedSecret: mf.sharedSecret, identitySecret: mf.identitySecret, deviceId: mf.deviceId || null, maFileFound: true };
        }
        return { ...acc, maFileFound: false };
    });
}

function applyMaFilesToGroup(groupId, type, maFiles) {
    const groups = loadGroups();
    const group  = getGroup(groups, groupId);
    if (!group) throw new Error(`Группа не найдена: ${groupId}`);

    const key    = type === 'farming' ? 'farmingAccounts' : 'storageAccounts';
    group[key]   = mergeMaFiles(group[key], maFiles);
    saveGroups(groups);
    return groups;
}

// ─── Обновление полей хранилки ────────────────────────────────────────────────

function updateStorageField(groupId, login, field, value) {
    const groups = loadGroups();
    const group  = getGroup(groups, groupId);
    if (!group) throw new Error(`Группа не найдена: ${groupId}`);

    const acc = group.storageAccounts.find(a => a.login.toLowerCase() === login.toLowerCase());
    if (acc) acc[field] = value;
    saveGroups(groups);
    return groups;
}

function saveItemSelection(groupId, names, dividedByTwo) {
    const groups = loadGroups();
    const g = getGroup(groups, groupId);
    if (!g) throw new Error('Группа не найдена');
    g.savedItemNames = Array.isArray(names) ? names : [];
    g.dividedByTwo   = dividedByTwo !== false;
    saveGroups(groups);
    return groups;
}

function updateGroupProxy(groupId, proxy) {
    const groups = loadGroups();
    const g = getGroup(groups, groupId);
    if (g) g.proxy = proxy ? proxy.trim() : '';
    saveGroups(groups);
    return groups;
}

module.exports = {
    loadGroups, saveGroups, getGroup,
    createGroup, deleteGroup, renameGroup,
    parseTxtFile, importAccounts,
    mergeMaFiles, applyMaFilesToGroup,
    updateStorageField, updateGroupProxy,
    saveItemSelection
};
