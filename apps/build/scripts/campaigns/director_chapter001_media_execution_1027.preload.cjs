const { contextBridge, ipcRenderer } = require('electron');
let active = false;
const invoke = async (channel, payload) => {
  if (!active) throw new Error('Generation bridges inactive before real singleton hydration');
  await ipcRenderer.invoke('chapter001-authorize', { channel, payload });
  const result = await ipcRenderer.invoke(channel, payload);
  if (channel === 'project-file-save-image') await ipcRenderer.invoke('chapter001-saved', result);
  return result;
};
contextBridge.exposeInMainWorld('chapter001Control', {
  activate: async () => { await ipcRenderer.invoke('chapter001-activate'); active = true; },
  readback: () => ipcRenderer.invoke('chapter001-readback'),
});
contextBridge.exposeInMainWorld('electronAPI', { imageRequest: payload => invoke('api-image-request', payload) });
contextBridge.exposeInMainWorld('projectFiles', {
  saveImage: payload => invoke('project-file-save-image', payload),
  readAsBase64: url => invoke('project-file-read-base64', url),
  readText: payload => invoke('project-file-read-text', payload),
});
contextBridge.exposeInMainWorld('studioAssets', { readUrlDataUrl: url => invoke('assets:read-url-data-url', url), readImageDataUrl: async id => invoke('assets:read-url-data-url', await ipcRenderer.invoke('chapter001-reference-id', id)) });
contextBridge.exposeInMainWorld('imageGenRuntime', { localImageToken: () => invoke('image-gen-runtime-local-token') });
