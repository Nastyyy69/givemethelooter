const fs = require('fs');
const path = require('path');

// ─── Парсинг одного .maFile ──────────────────────────────────────────────────

function parseMaFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);

    return {
        accountName:    data.account_name   || null,
        sharedSecret:   data.shared_secret  || null,
        identitySecret: data.identity_secret || null,
        deviceId:       data.device_id      || null,
        steamId:        data.Session?.SteamID || data.session?.SteamID || null
    };
}

// ─── Сканирование папки ──────────────────────────────────────────────────────

function scanFolder(folderPath) {
    const entries = fs.readdirSync(folderPath);
    const results = [];

    for (const entry of entries) {
        if (!entry.endsWith('.maFile')) continue;

        try {
            const parsed = parseMaFile(path.join(folderPath, entry));

            if (!parsed.accountName || !parsed.sharedSecret || !parsed.identitySecret) {
                console.warn(`[maFile] Пропущен ${entry}: отсутствуют обязательные поля`);
                continue;
            }

            results.push(parsed);
        } catch (e) {
            console.warn(`[maFile] Не удалось прочитать ${entry}: ${e.message}`);
        }
    }

    return results;
}

module.exports = { parseMaFile, scanFolder };
