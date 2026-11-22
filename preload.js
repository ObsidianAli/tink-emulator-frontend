// The only things the UI is allowed to ask the main process for.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tink', {
  getLibrary: () => ipcRenderer.invoke('getLibrary'),
  launch: (appId) => ipcRenderer.invoke('launch', appId),
});
