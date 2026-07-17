(() => {
  // biome-ignore lint/suspicious/noRedundantUseStrict: loaded as a classic script, not an ECMAScript module.
  'use strict';

  const PROTOCOL_VERSION = 2;
  const RECONNECT_WINDOW_MS = 2 * 60 * 1000;
  const CONNECT_TIMEOUT_MS = 12 * 1000;
  const STORAGE_KEY = 'spectra_remote_pairings_v2';
  const REMOTE_ORIGIN = 'https://nexus-remote.pages.dev';
  const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
  const NONCE_RE = /^[A-Za-z0-9_-]{43}$/;
  const COMMANDS = new Set([
    'volume_down', 'volume_up', 'volume_100', 'volume_max', 'mute', 'play_pause',
    'boost_down', 'boost_up', 'boost_reset', 'boost_max',
    'seek_backward_30', 'seek_backward', 'seek_forward', 'seek_forward_30',
    'speed_down', 'speed_reset', 'speed_up',
  ]);

  const byId = (id) => document.getElementById(id);
  const statusDot = byId('status-dot');
  const statusText = byId('status-text');
  const pairingNotice = byId('pairing-notice');
  const remoteView = byId('remote-view');
  const sessionsBar = byId('sessions-bar');
  const addDialog = byId('add-session-dialog');
  const addForm = byId('add-session-form');
  const pairingInput = byId('pairing-link');
  const pairingError = byId('pairing-error');
  const commandButtons = [...document.querySelectorAll('[data-command]')];
  const sessions = new Map();
  let activeSessionId = null;

  class RemoteSessionClient {
    constructor(pairing) {
      this.pairing = { ...pairing };
      this.peer = null;
      this.connection = null;
      this.authenticated = false;
      this.everAuthenticated = pairing.authenticatedOnce === true;
      this.generation = 0;
      this.sequence = 0;
      this.attempt = 0;
      this.retryCount = 0;
      this.reconnectDeadline = 0;
      this.retryTimer = null;
      this.connectTimer = null;
      this.terminal = false;
      this.connected = false;
      this.statusMessage = 'Waiting to connect…';
      this.state = {
        volume: 100,
        actualMode: 'bypass',
        phase: 'idle',
        volumeState: 'native',
        muted: false,
        playing: false,
        speed: 1,
        tabTitle: '',
        tabDomain: '',
      };
    }

    connect() {
      if (this.terminal || !TOKEN_RE.test(this.pairing.secret)) return;
      this.disposeTransport();
      const currentAttempt = ++this.attempt;
      this.authenticated = false;
      this.connected = false;
      this.setStatus('Connecting securely…');

      this.peer = new window.Peer({ debug: 0, referrerPolicy: 'no-referrer' });
      this.connectTimer = window.setTimeout(() => {
        if (currentAttempt === this.attempt && !this.authenticated) this.handleDisconnect('Connection timed out');
      }, CONNECT_TIMEOUT_MS);

      this.peer.on('open', () => {
        if (currentAttempt !== this.attempt || !this.peer) return;
        this.connection = this.peer.connect(this.pairing.peerId, {
          reliable: true,
          metadata: { protocolVersion: PROTOCOL_VERSION, sessionId: this.pairing.sessionId },
        });
        this.connection.on('open', () => {
          if (currentAttempt === this.attempt) this.setStatus('Authenticating…');
        });
        this.connection.on('data', (data) => {
          if (currentAttempt === this.attempt) void this.handleMessage(data);
        });
        this.connection.on('close', () => {
          if (currentAttempt === this.attempt) this.handleDisconnect('Connection closed');
        });
        this.connection.on('error', () => {
          if (currentAttempt === this.attempt) this.handleDisconnect('Data channel error');
        });
      });

      this.peer.on('error', (error) => {
        if (currentAttempt !== this.attempt) return;
        const unavailable = error && error.type === 'peer-unavailable';
        this.handleDisconnect(unavailable ? 'Pairing host is unavailable' : 'Signaling connection failed');
      });
    }

    async handleMessage(data) {
      if (!isObject(data)
        || data.protocolVersion !== PROTOCOL_VERSION
        || data.sessionId !== this.pairing.sessionId) return;

      if (data.type === 'spectra.remote.challenge') {
        if (this.authenticated || !NONCE_RE.test(data.nonce) || !Number.isFinite(data.pairingExpiresAt)) return;
        if (Date.now() > data.pairingExpiresAt) {
          this.handleDisconnect('Pairing has expired', true);
          return;
        }
        try {
          const proof = await createProof(this.pairing.secret, this.pairing.sessionId, data.nonce);
          if (this.connection?.open) {
            this.connection.send({
              type: 'spectra.remote.authenticate',
              protocolVersion: PROTOCOL_VERSION,
              sessionId: this.pairing.sessionId,
              proof,
            });
          }
        } catch {
          this.handleDisconnect('Authentication is unavailable in this browser', true);
        }
        return;
      }

      if (data.type === 'spectra.remote.auth-result') {
        if (data.ok !== true) {
          const messages = {
            EXPIRED: 'Pairing has expired',
            ALREADY_CONNECTED: 'Already controlled by another device',
            AUTH_FAILED: 'Authentication failed',
            INVALID_MESSAGE: 'Host rejected authentication',
          };
          this.handleDisconnect(messages[data.error] || 'Authentication failed', true);
          return;
        }
        this.authenticated = true;
        this.connected = true;
        this.everAuthenticated = true;
        this.pairing.authenticatedOnce = true;
        this.retryCount = 0;
        this.reconnectDeadline = 0;
        this.sequence = 0;
        window.clearTimeout(this.connectTimer);
        this.setStatus('Authenticated and connected');
        savePairings();
        return;
      }

      if (data.type === 'spectra.remote.state' && this.authenticated && isRemoteState(data)) {
        this.generation = data.generation;
        this.state = {
          volume: Math.round(Math.max(0, Math.min(800, data.volume)) * 10) / 10,
          actualMode: data.actualMode || 'bypass',
          phase: data.phase || 'idle',
          volumeState: data.volumeState || deriveVolumeState(data),
          muted: data.muted,
          playing: data.playing,
          speed: Math.max(0.25, Math.min(16, data.speed)),
          tabTitle: cleanText(data.tabTitle, 512),
          tabDomain: cleanText(data.tabDomain, 253),
        };
        render();
        return;
      }

      if (data.type === 'spectra.remote.closed' && this.authenticated && isCloseReason(data.reason)) {
        this.handleDisconnect(closeReasonMessage(data.reason), true);
      }
    }

    sendCommand(command) {
      if (!this.authenticated
        || !this.connection?.open
        || !COMMANDS.has(command)
        || !TOKEN_RE.test(this.pairing.sessionId)) return;
      this.sequence += 1;
      this.connection.send({
        type: 'spectra.remote.command',
        protocolVersion: PROTOCOL_VERSION,
        sessionId: this.pairing.sessionId,
        sequence: this.sequence,
        generation: this.generation,
        command,
      });
    }

    handleDisconnect(message, isTerminal = false) {
      if (this.terminal) return;
      this.authenticated = false;
      this.connected = false;
      this.setStatus(message);
      this.disposeTransport();

      if (isTerminal) {
        this.terminal = true;
        this.pairing.secret = '';
        savePairings();
        render();
        return;
      }

      if (!this.reconnectDeadline) {
        this.reconnectDeadline = this.everAuthenticated
          ? Date.now() + RECONNECT_WINDOW_MS
          : this.pairing.pairingExpiresAt;
      }
      if (Date.now() >= this.reconnectDeadline) {
        this.terminal = true;
        this.pairing.secret = '';
        this.setStatus(this.everAuthenticated ? 'Reconnect window expired' : 'Pairing link expired');
        savePairings();
        render();
        return;
      }

      this.retryCount += 1;
      const delay = Math.min(10_000, 500 * (2 ** Math.min(this.retryCount, 5)));
      this.setStatus(`Reconnecting in ${Math.ceil(delay / 1000)}s…`);
      this.retryTimer = window.setTimeout(() => this.connect(), delay);
    }

    setStatus(message) {
      this.statusMessage = message;
      render();
    }

    disposeTransport() {
      window.clearTimeout(this.connectTimer);
      window.clearTimeout(this.retryTimer);
      this.connectTimer = null;
      this.retryTimer = null;
      const oldConnection = this.connection;
      const oldPeer = this.peer;
      this.connection = null;
      this.peer = null;
      this.attempt += 1;
      try { oldConnection?.close(); } catch { /* already closed */ }
      try { oldPeer?.destroy(); } catch { /* already destroyed */ }
    }

    destroy() {
      this.terminal = true;
      this.authenticated = false;
      this.connected = false;
      this.pairing.secret = '';
      this.disposeTransport();
    }
  }

  initializeTheme();
  bindUi();
  setControlsEnabled(false);

  const initialPairing = readFragmentPairing();
  const pairings = loadPairings();
  if (initialPairing) upsertPairing(pairings, initialPairing);
  for (const pairing of pairings) {
    if (Date.now() <= pairing.pairingExpiresAt || pairing.authenticatedOnce === true) {
      addSession(pairing, false);
    }
  }
  if (initialPairing && sessions.has(initialPairing.sessionId)) activeSessionId = initialPairing.sessionId;
  if (!activeSessionId) activeSessionId = sessions.keys().next().value || null;
  savePairings();
  render();
  for (const client of sessions.values()) client.connect();

  function addSession(pairing, makeActive = true) {
    const existing = sessions.get(pairing.sessionId);
    if (existing) {
      existing.pairing = { ...pairing };
      if (existing.terminal) existing.terminal = false;
    } else {
      sessions.set(pairing.sessionId, new RemoteSessionClient(pairing));
    }
    if (makeActive) activeSessionId = pairing.sessionId;
  }

  function removeSession(sessionId) {
    const client = sessions.get(sessionId);
    client?.destroy();
    sessions.delete(sessionId);
    if (activeSessionId === sessionId) activeSessionId = sessions.keys().next().value || null;
    savePairings();
    render();
  }

  function render() {
    const active = activeSessionId ? sessions.get(activeSessionId) : null;
    setViewVisible(pairingNotice, sessions.size === 0);
    setViewVisible(remoteView, sessions.size > 0);
    renderSessionTabs();

    if (!active) {
      setHeaderStatus('Secure pairing required', false);
      setControlsEnabled(false);
      return;
    }

    setHeaderStatus(active.statusMessage, active.connected);
    setControlsEnabled(active.authenticated);
    byId('vol-display').textContent = `${formatVolume(active.state.volume)}%`;
    const volumeDisplay = byId('volume-display');
    volumeDisplay.classList.toggle(
      'capture-active',
		active.state.volumeState === 'capture',
    );
    volumeDisplay.classList.toggle('silent', active.state.volumeState === 'silent');
    byId('btn-mute').classList.toggle('muted', active.state.muted);
    byId('btn-play-pause').textContent = active.state.playing ? '⏸' : '▶';
    byId('speed-display').textContent = `${active.state.speed.toFixed(2)}x`;
    byId('tab-title').textContent = active.state.tabTitle || 'Waiting for authenticated sync…';
    byId('tab-domain').textContent = active.state.tabDomain || active.pairing.sessionId.slice(0, 8);
  }

  function renderSessionTabs() {
    const nodes = [];
    for (const [sessionId, client] of sessions) {
      const tab = document.createElement('div');
      tab.className = `session-tab${sessionId === activeSessionId ? ' active' : ''}`;

      const select = document.createElement('button');
      select.className = 'session-select';
      select.type = 'button';
      select.setAttribute('aria-label', `Control ${client.state.tabTitle || client.state.tabDomain || sessionId.slice(0, 8)}`);
      const dot = document.createElement('span');
      dot.className = `session-dot${client.connected ? ' connected' : ''}`;
      const label = document.createElement('span');
      label.className = 'session-label';
      label.textContent = client.state.tabDomain || client.state.tabTitle || sessionId.slice(0, 8);
      select.append(dot, label);
      select.addEventListener('click', () => {
        activeSessionId = sessionId;
        render();
      });

      const remove = document.createElement('button');
      remove.className = 'remove-session';
      remove.type = 'button';
      remove.textContent = '✕';
      remove.setAttribute('aria-label', `Remove pairing ${label.textContent}`);
      remove.addEventListener('click', () => removeSession(sessionId));
      tab.append(select, remove);
      nodes.push(tab);
    }

    const add = document.createElement('button');
    add.className = 'add-session';
    add.type = 'button';
    add.textContent = '+ Add';
    add.addEventListener('click', showAddDialog);
    nodes.push(add);
    sessionsBar.replaceChildren(...nodes);
  }

  function bindUi() {
    for (const button of commandButtons) {
      button.addEventListener('click', () => {
        const active = activeSessionId ? sessions.get(activeSessionId) : null;
        active?.sendCommand(button.dataset.command);
      });
    }
    byId('btn-forget').addEventListener('click', () => {
      for (const client of sessions.values()) client.destroy();
      sessions.clear();
      sessionStorage.removeItem(STORAGE_KEY);
      activeSessionId = null;
      render();
    });
    byId('btn-add-first').addEventListener('click', showAddDialog);
    byId('btn-cancel-add').addEventListener('click', () => addDialog.close());
    addForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const pairing = parsePairingLink(pairingInput.value);
      if (!pairing || Date.now() > pairing.pairingExpiresAt) {
        pairingError.textContent = 'Invalid or expired SPECTRA pairing link.';
        return;
      }
      addSession(pairing);
      savePairings();
      const client = sessions.get(pairing.sessionId);
      if (client && !client.connected) client.connect();
      addDialog.close();
      render();
    });
  }

  function showAddDialog() {
    pairingInput.value = '';
    pairingError.textContent = '';
    addDialog.showModal();
    pairingInput.focus();
  }

  function setControlsEnabled(enabled) {
    for (const button of commandButtons) button.disabled = !enabled;
  }

  function setHeaderStatus(message, connected) {
    statusText.textContent = message;
    statusDot.classList.toggle('connected', connected);
  }

  function readFragmentPairing() {
    if (location.hash.length <= 1) return null;
    const pairing = pairingFromParams(new URLSearchParams(location.hash.slice(1)));
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    return pairing;
  }

  function parsePairingLink(value) {
    try {
      const url = new URL(value.trim());
      if (url.origin !== REMOTE_ORIGIN && url.origin !== location.origin) return null;
      return pairingFromParams(new URLSearchParams(url.hash.slice(1)));
    } catch {
      return null;
    }
  }

  function pairingFromParams(fragment) {
    const value = {
      protocolVersion: Number(fragment.get('v')),
      sessionId: fragment.get('s') || '',
      peerId: fragment.get('p') || '',
      secret: fragment.get('k') || '',
      pairingExpiresAt: Number(fragment.get('e')),
      authenticatedOnce: false,
    };
    return isPairing(value) ? value : null;
  }

  function isPairing(value) {
    return value && value.protocolVersion === PROTOCOL_VERSION
      && TOKEN_RE.test(value.sessionId)
      && /^spectra-[a-f0-9]{32}$/.test(value.peerId)
      && TOKEN_RE.test(value.secret)
      && Number.isFinite(value.pairingExpiresAt)
      && (value.authenticatedOnce === undefined || typeof value.authenticatedOnce === 'boolean');
  }

  function loadPairings() {
    try {
      const values = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(values) ? values.filter(isPairing) : [];
    } catch {
      return [];
    }
  }

  function savePairings() {
    const values = [...sessions.values()]
      .filter((client) => !client.terminal && isPairing(client.pairing))
      .map((client) => client.pairing);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(values));
  }

  function upsertPairing(values, pairing) {
    const index = values.findIndex((item) => item.sessionId === pairing.sessionId);
    if (index >= 0) values[index] = pairing;
    else values.push(pairing);
  }

  function isRemoteState(data) {
    return Number.isSafeInteger(data.generation) && data.generation >= 0
      && Number.isFinite(data.volume)
      && (data.volumeBase === undefined || Number.isFinite(data.volumeBase))
      && (data.boost === undefined || Number.isFinite(data.boost))
      && (data.actualMode === undefined
        || data.actualMode === 'bypass'
        || data.actualMode === 'webaudio'
        || data.actualMode === 'capture')
      && (data.phase === undefined
        || data.phase === 'idle'
        || data.phase === 'starting'
        || data.phase === 'active'
        || data.phase === 'stopping'
        || data.phase === 'error')
		&& (data.volumeState === undefined
			|| data.volumeState === 'silent'
			|| data.volumeState === 'native'
			|| data.volumeState === 'capture')
      && typeof data.muted === 'boolean'
      && typeof data.playing === 'boolean'
      && Number.isFinite(data.speed)
      && (data.tabTitle === undefined || typeof data.tabTitle === 'string')
      && (data.tabDomain === undefined || typeof data.tabDomain === 'string');
  }

  function formatVolume(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
  }

  function deriveVolumeState(data) {
    if (data.muted || data.volume <= 0) return 'silent';
    return data.actualMode === 'capture' && data.phase === 'active' ? 'capture' : 'native';
  }

  function isCloseReason(value) {
    return value === 'manual'
      || value === 'tab-closed'
      || value === 'pairing-expired'
      || value === 'reconnect-expired'
      || value === 'host-destroyed';
  }

  function closeReasonMessage(reason) {
    if (reason === 'tab-closed') return 'The controlled tab was closed';
    if (reason === 'pairing-expired') return 'Pairing has expired';
    if (reason === 'reconnect-expired') return 'Reconnect window expired';
    return 'Remote session was closed';
  }

  function setViewVisible(element, visible) {
    element.classList.toggle('hidden', !visible);
    element.hidden = !visible;
    element.setAttribute('aria-hidden', String(!visible));
    element.toggleAttribute('inert', !visible);
  }

  async function createProof(secret, sessionId, nonce) {
    const key = await crypto.subtle.importKey(
      'raw',
      decodeBase64Url(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const payload = new TextEncoder().encode(`spectra-remote-v2\n${sessionId}\n${nonce}\n${PROTOCOL_VERSION}`);
    const signature = await crypto.subtle.sign('HMAC', key, payload);
    return encodeBase64Url(new Uint8Array(signature));
  }

  function decodeBase64Url(value) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  function encodeBase64Url(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
  }

  function cleanText(value, maxLength) {
    return typeof value === 'string' ? value.slice(0, maxLength) : '';
  }

  function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function initializeTheme() {
    const button = byId('btn-theme');
    const light = localStorage.getItem('spectra_remote_theme') === 'light';
    document.documentElement.classList.toggle('light', light);
    button.textContent = light ? '☀️' : '🌙';
    button.addEventListener('click', () => {
      const nextLight = !document.documentElement.classList.contains('light');
      document.documentElement.classList.toggle('light', nextLight);
      button.textContent = nextLight ? '☀️' : '🌙';
      localStorage.setItem('spectra_remote_theme', nextLight ? 'light' : 'dark');
    });
  }
})();
