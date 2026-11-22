// The only things the UI is allowed to ask the main process for.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tink', {
  getSetup: () => ipcRenderer.invoke('getSetup'),
  pickExe: (id) => ipcRenderer.invoke('pickExe', id),
  pickFolder: (id) => ipcRenderer.invoke('pickFolder', id),
  clearFolder: (id) => ipcRenderer.invoke('clearFolder', id),
  finishSetup: (covers) => ipcRenderer.invoke('finishSetup', covers),
  getLibrary: () => ipcRenderer.invoke('getLibrary'),
  getCover: (id) => ipcRenderer.invoke('getCover', id),
  launch: (id) => ipcRenderer.invoke('launch', id),
});
