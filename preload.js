// The only things the UI is allowed to ask the main process for.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tink', {
  getSetup: () => ipcRenderer.invoke('getSetup'),
  pickExe: (id) => ipcRenderer.invoke('pickExe', id),
  pickFolder: (id) => ipcRenderer.invoke('pickFolder', id),
  clearFolder: (id) => ipcRenderer.invoke('clearFolder', id),
  finishSetup: (covers) => ipcRenderer.invoke('finishSetup', covers),
  getSettings: () => ipcRenderer.invoke('getSettings'),
  setFullscreen: (on) => ipcRenderer.invoke('setFullscreen', on),
  setSteamKey: (key) => ipcRenderer.invoke('setSteamKey', key),
  findAutomatically: (id) => ipcRenderer.invoke('findAutomatically', id),
  redownloadCovers: () => ipcRenderer.invoke('redownloadCovers'),
  logError: (text) => ipcRenderer.invoke('logError', text),
  getLibrary: () => ipcRenderer.invoke('getLibrary'),
  getCover: (id) => ipcRenderer.invoke('getCover', id),
  getUpdate: () => ipcRenderer.invoke('getUpdate'),
  applyUpdate: () => ipcRenderer.invoke('applyUpdate'),
  getNotice: () => ipcRenderer.invoke('getNotice'),
  launch: (id) => ipcRenderer.invoke('launch', id),
});
