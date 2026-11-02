const { app, BrowserWindow, ipcMain, session, systemPreferences } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

let mainWindow;
let aiBackendProcess = null;

const AI_BACKEND_PORT = 8765;
const AI_BACKEND_URL = `http://127.0.0.1:${AI_BACKEND_PORT}`;
const APP_ICON = path.join(__dirname, 'assets', 'ZERO.png');
const RENDERER_ENTRY_URL = process.env.ZERO_RENDERER_URL;
const BLOCKED_PROTOCOLS = new Set(['javascript:', 'data:', 'file:', 'vbscript:']);
const TRACKER_RULES = [
  { match: /doubleclick|google-analytics|googletagmanager|facebook\.net|adsystem|adservice/i, category: 'Advertising tracker' },
  { match: /mixpanel|segment|amplitude|hotjar|fullstory|intercom/i, category: 'Analytics tracker' },
  { match: /fingerprint|canvas|device-memory|font-detect|browserprint/i, category: 'Fingerprinting script', fingerprinting: true },
];
const SUSPICIOUS_DOWNLOAD_EXTENSIONS = /\.(exe|msi|pkg|dmg|scr|bat|cmd|apk|zip|iso)$/i;

function isLocalHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function isIpAddress(hostname) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

function shouldGrantMediaPermission(details) {
  if (Array.isArray(details?.mediaTypes) && details.mediaTypes.length > 0) {
    return !details.mediaTypes.includes('video');
  }

  if (typeof details?.mediaType === 'string') {
    return details.mediaType !== 'video';
  }

  return true;
}

function getMicrophoneAccessDetails() {
  if (process.platform !== 'darwin') {
    return {
      status: 'granted',
      granted: true,
      prompted: false,
      platform: process.platform,
    };
  }

  const status = systemPreferences.getMediaAccessStatus('microphone');
  return {
    status,
    granted: status === 'granted',
    prompted: false,
    platform: process.platform,
  };
}

async function requestMicrophoneAccess() {
  const current = getMicrophoneAccessDetails();
  if (current.granted || process.platform !== 'darwin') {
    return current;
  }

  const granted = await systemPreferences.askForMediaAccess('microphone');
  return {
    status: systemPreferences.getMediaAccessStatus('microphone'),
    granted,
    prompted: true,
    platform: process.platform,
  };
}

function emitSecurityEvent(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('zero-security-event', {
    ...payload,
    timestamp: new Date().toISOString(),
  });
}

function assessResolvedUrl(candidate) {
  try {
    const url = new URL(candidate);
    const reasons = [];

    if (BLOCKED_PROTOCOLS.has(url.protocol)) {
      return {
        ok: false,
        blocked: true,
        requiresConfirmation: false,
        url: url.href,
        reasons: [`Blocked dangerous protocol: ${url.protocol}`],
      };
    }

    if (!['https:', 'http:'].includes(url.protocol)) {
      return {
        ok: false,
        blocked: true,
        requiresConfirmation: false,
        url: url.href,
        reasons: [`Unsupported protocol: ${url.protocol}`],
      };
    }

    if (url.protocol === 'http:' && !isLocalHost(url.hostname)) {
      reasons.push('This site is not using HTTPS encryption.');
    }

    if (url.username || url.password) {
      reasons.push('This link contains embedded login credentials.');
    }

    if (isIpAddress(url.hostname) && !isLocalHost(url.hostname)) {
      reasons.push('This link goes directly to an IP address instead of a named domain.');
    }

    if (url.hostname.includes('xn--')) {
      reasons.push('This domain uses punycode and could be impersonating another site.');
    }

    if (url.hostname.split('-').length > 4) {
      reasons.push('This domain looks unusually complex.');
    }

    return {
      ok: true,
      blocked: false,
      requiresConfirmation: reasons.length > 0,
      url: url.href,
      reasons,
    };
  } catch {
    return {
      ok: false,
      blocked: true,
      requiresConfirmation: false,
      url: candidate,
      reasons: ['Invalid or malformed URL.'],
    };
  }
}

function classifyRequest(details) {
  const url = String(details.url || '');
  const resourceType = String(details.resourceType || '');

  for (const rule of TRACKER_RULES) {
    if (!rule.match.test(url)) continue;
    const eventType = rule.fingerprinting ? 'fingerprinting-blocked' : 'tracker-blocked';
    return {
      cancel: true,
      event: {
        type: eventType,
        category: rule.category,
        url,
        resourceType,
        webContentsId: details.webContentsId || null,
      },
    };
  }

  if (resourceType === 'script' && /screen\.width|deviceMemory|hardwareConcurrency/i.test(url)) {
    return {
      cancel: true,
      event: {
        type: 'fingerprinting-blocked',
        category: 'Fingerprinting script',
        url,
        resourceType,
        webContentsId: details.webContentsId || null,
      },
    };
  }

  return { cancel: false, event: null };
}

function setupSecurityHooks() {
  const ses = session.defaultSession;

  ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    const result = classifyRequest(details);
    if (result.cancel) {
      emitSecurityEvent(result.event);
      callback({ cancel: true });
      return;
    }
    callback({});
  });

  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (['notifications', 'midi', 'midiSysex', 'display-capture'].includes(permission)) {
      return false;
    }

    if (permission === 'media') {
      return shouldGrantMediaPermission(details);
    }

    return true;
  });

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (['notifications', 'midi', 'midiSysex', 'display-capture'].includes(permission)) {
      emitSecurityEvent({
        type: 'permission-blocked',
        permission,
        origin: details?.requestingOrigin || details?.securityOrigin || '',
        webContentsId: webContents.id,
      });
      callback(false);
      return;
    }

    if (permission === 'media') {
      const granted = shouldGrantMediaPermission(details);
      if (!granted) {
        emitSecurityEvent({
          type: 'permission-blocked',
          permission: 'camera',
          origin: details?.securityOrigin || '',
          webContentsId: webContents.id,
        });
      }
      callback(granted);
      return;
    }

    callback(true);
  });

  ses.on('will-download', (event, item, webContents) => {
    const filename = item.getFilename();
    const url = item.getURL();
    const shouldBlock = SUSPICIOUS_DOWNLOAD_EXTENSIONS.test(filename) || SUSPICIOUS_DOWNLOAD_EXTENSIONS.test(url);

    if (shouldBlock) {
      event.preventDefault();
      emitSecurityEvent({
        type: 'download-blocked',
        filename,
        url,
        webContentsId: webContents.id,
      });
      return;
    }

    emitSecurityEvent({
      type: 'download-recorded',
      filename,
      url,
      status: 'started',
      webContentsId: webContents.id,
    });

    item.once('done', (downloadEvent, state) => {
      emitSecurityEvent({
        type: 'download-recorded',
        filename,
        url,
        status: state,
        webContentsId: webContents.id,
      });
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 760,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
    },
    title: 'ZERO Browser',
    icon: APP_ICON,
    backgroundColor: '#060a18',
    show: false,
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('zero-security-event', {
        type: 'download-recorded',
        status: 'popup-rerouted',
        url,
        filename: 'External window redirected into current tab',
        webContentsId: mainWindow.webContents.id,
        timestamp: new Date().toISOString(),
      });
    }
    return { action: 'deny' };
  });

  const loadRenderer = RENDERER_ENTRY_URL
    ? mainWindow.loadURL(RENDERER_ENTRY_URL)
    : mainWindow.loadFile('index.html');

  loadRenderer.catch((error) => {
    console.error('Failed to load renderer entry:', error);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

function startAIBackend() {
  if (aiBackendProcess) return;
  aiBackendProcess = spawn('python3', [path.join(__dirname, 'ai_backend.py')], {
    cwd: __dirname,
    env: {
      ...process.env,
      ZERO_AI_BACKEND_PORT: String(AI_BACKEND_PORT),
    },
    stdio: 'ignore',
  });
  aiBackendProcess.on('exit', () => {
    aiBackendProcess = null;
  });
}

async function ensureAIBackend() {
  startAIBackend();

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(`${AI_BACKEND_URL}/health`);
      if (response.ok) return true;
    } catch {
      // Wait for backend readiness.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return false;
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(APP_ICON);
  }
  setupSecurityHooks();
  await Promise.all([
    requestMicrophoneAccess(),
    ensureAIBackend(),
  ]);
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  if (aiBackendProcess) {
    aiBackendProcess.kill();
    aiBackendProcess = null;
  }
});

ipcMain.handle('load-url', async (event, url) => {
  const input = String(url || '').trim();
  if (!input) return null;

  try {
    const hasScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(input);
    const looksLikeDomain = /^[^\s]+\.[^\s]{2,}$/.test(input);
    const candidate = hasScheme ? input : (looksLikeDomain ? `https://${input}` : null);
    if (!candidate) {
      return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
    }
    return new URL(candidate).href;
  } catch {
    return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
  }
});

ipcMain.handle('assess-url', async (event, url) => {
  return assessResolvedUrl(String(url || '').trim());
});

ipcMain.handle('get-microphone-access', async () => {
  return getMicrophoneAccessDetails();
});

ipcMain.handle('request-microphone-access', async () => {
  return requestMicrophoneAccess();
});

ipcMain.handle('ai-chat', async (event, payload) => {
  const backendReady = await ensureAIBackend();
  if (!backendReady) {
    return {
      ok: false,
      error: 'Zero AI backend could not start.',
    };
  }

  try {
    const response = await fetch(`${AI_BACKEND_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      return {
        ok: false,
        error: errorData?.error || `Zero AI backend error ${response.status}.`,
      };
    }

    const data = await response.json();
    return {
      ok: Boolean(data?.ok),
      content: data?.content || 'No response returned by Ollama.',
      model: data?.model,
      available_models: data?.available_models || [],
      error: data?.error,
    };
  } catch (error) {
    return {
      ok: false,
      error: `Zero AI backend request failed. ${error.message}`,
    };
  }
});
