const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // Группы
    getGroups:    ()           => ipcRenderer.invoke('get-groups'),
    createGroup:  (name, proxy) => ipcRenderer.invoke('create-group', name, proxy),
    deleteGroup:  (id)         => ipcRenderer.invoke('delete-group', id),
    renameGroup:  (id, name)   => ipcRenderer.invoke('rename-group', id, name),

    // Аккаунты
    importTxt:    (groupId, type)        => ipcRenderer.invoke('import-txt', groupId, type),
    openMaFiles:  (groupId, type)        => ipcRenderer.invoke('open-mafiles', groupId, type),

    // Прокси группы
    updateGroupProxy: (groupId, proxy) => ipcRenderer.invoke('update-group-proxy', groupId, proxy),

    // Хранилки
    updateTradeUrl:        (groupId, login, url) => ipcRenderer.invoke('update-trade-url', groupId, login, url),
    toggleStorageSelected: (groupId, login)      => ipcRenderer.invoke('toggle-storage-selected', groupId, login),

    // Удаление аккаунтов
    deleteAccounts: (groupId, type, logins) => ipcRenderer.invoke('delete-accounts', groupId, type, logins),

    // Торговля
    collectDirect:    (groupId)                              => ipcRenderer.invoke('collect-direct', groupId),
    fetchItems:       (groupId)                              => ipcRenderer.invoke('fetch-items', groupId),
    saveItemSelection:(groupId, names, dividedByTwo)         => ipcRenderer.invoke('save-item-selection', groupId, names, dividedByTwo),
    createTrades:     (groupId, dividedByTwo, selectedNames) => ipcRenderer.invoke('create-trades', groupId, dividedByTwo, selectedNames),
    runAllGroups:     ()                                     => ipcRenderer.invoke('run-all-groups'),

    // Внешние ссылки
    openExternal: (url) => ipcRenderer.invoke('open-external', url),

    // Лог
    onLog: (cb) => ipcRenderer.on('log', (_, msg, level) => cb(msg, level))
});
