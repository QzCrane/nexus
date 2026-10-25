(() => {
  // biome-ignore lint/suspicious/noRedundantUseStrict: loaded as a classic script, not an ECMAScript module.
  'use strict';

  // The wire protocol lives once in the extension and is projected to
  // dist/protocol.js before this classic script runs. This page must never own a
  // second copy of the version, challenge payload, HMAC, or wire validators.
  const {
    REMOTE_PROTOCOL_VERSION,
    createRemoteProof,
    generateRandomToken,
    isRemoteAuthResultMessage,
    isRemoteChallengeMessage,
    isRemoteClosedMessage,
    isRemoteCommand,
    isRemotePeerId,
    isRemoteStateMessage,
    isSessionId,
  } = globalThis.SpectraRemoteProtocol;

  const RECONNECT_WINDOW_MS = 2 * 60 * 1000;
  const CONNECT_TIMEOUT_MS = 12 * 1000;
  const STORAGE_KEY = 'spectra_remote_pairings_v3';
  const MAX_PAIRINGS = 16;
  const MAX_PAIRING_STORAGE_BYTES = 64 * 1024;
  const REMOTE_ORIGIN = 'https://nexus-remote.pages.dev';

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
  let peerRuntimePromise = null;

  function loadPeerRuntime() {
    if (!peerRuntimePromise) {
      peerRuntimePromise = import('./vendor/peerjs.min.js').then((module) => {
        if (typeof module.default !== 'function') throw new Error('Local PeerJS transport has no default constructor');
        return module.default;
      }).catch((error) => {
        peerRuntimePromise = null;
        throw error;
      });
    }
    return peerRuntimePromise;
  }

  class RemoteSessionClient {
    constructor(pairing) {
      this.pairing = { ...pairing };
      this.peer = null;
      this.connection = null;
      this.authenticated = false;
      this.everAuthenticated = pairing.authenticatedOnce === true;
      this.generation = 0;
      this.revision = 0;
      this.sessionEpoch = 0;
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
		volumeBase: 100,
		boost: 1,
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
      if (this.terminal || !isSessionId(this.pairing.secret)) return;
      this.disposeTransport();
      const currentAttempt = ++this.attempt;
      this.authenticated = false;
      this.connected = false;
      this.setStatus('Connecting securely…');

      this.connectTimer = window.setTimeout(() => {
        if (this.attempt === currentAttempt && !this.authenticated) {
          this.handleDisconnect('Connection timed out', false, currentAttempt, this.peer);
        }
      }, CONNECT_TIMEOUT_MS);

      void loadPeerRuntime().then((Peer) => {
        if (this.terminal || this.attempt !== currentAttempt || this.peer !== null) return;
        try {
          this.peer = new Peer({ debug: 0, referrerPolicy: 'no-referrer' });
        } catch (error) {
          this.handleConnectFailure('Peer runtime unavailable', currentAttempt, error);
          return;
        }
        const currentPeer = this.peer;

        currentPeer.on('open', () => {
          if (!this.isCurrentTransport(currentAttempt, currentPeer)) return;
          let connection;
          try {
            connection = currentPeer.connect(this.pairing.peerId, {
              reliable: true,
              serialization: 'json',
              metadata: { protocolVersion: REMOTE_PROTOCOL_VERSION, sessionId: this.pairing.sessionId },
            });
          } catch (error) {
            this.handleDisconnect('Connection unavailable', false, currentAttempt, currentPeer);
            console.warn('Remote data channel could not be created', error);
            return;
          }
          if (!connection) {
            this.handleDisconnect('Connection unavailable', false, currentAttempt, currentPeer);
            return;
          }
          this.connection = connection;
          connection.on('open', () => {
            if (this.isCurrentTransport(currentAttempt, currentPeer, connection)) {
              this.setStatus('Authenticating…');
            }
          });
          connection.on('data', (data) => {
            if (this.isCurrentTransport(currentAttempt, currentPeer, connection)) {
              void this.handleMessage(data, currentAttempt, currentPeer, connection);
            }
          });
          connection.on('close', () => {
            if (this.isCurrentTransport(currentAttempt, currentPeer, connection)) {
              this.handleDisconnect('Connection closed', false, currentAttempt, currentPeer, connection);
            }
          });
          connection.on('error', () => {
            if (this.isCurrentTransport(currentAttempt, currentPeer, connection)) {
              this.handleDisconnect('Data channel error', false, currentAttempt, currentPeer, connection);
            }
          });
        });

        currentPeer.on('disconnected', () => {
          if (!this.isCurrentTransport(currentAttempt, currentPeer)) return;
          if (this.authenticated && this.connection?.open) {
            this.setStatus('Signaling interrupted; data channel retained');
            try {
              currentPeer.reconnect();
            } catch (error) {
              this.handleConnectFailure('Signaling recovery unavailable', currentAttempt, error);
            }
            return;
          }
          this.handleDisconnect('Signaling connection interrupted', false, currentAttempt, currentPeer);
        });
        currentPeer.on('close', () => {
          if (this.isCurrentTransport(currentAttempt, currentPeer)) {
            if (this.authenticated && this.connection?.open) {
              this.setStatus('Signaling closed; data channel retained');
            } else {
              this.handleDisconnect('Signaling connection closed', false, currentAttempt, currentPeer);
            }
          }
        });
        currentPeer.on('error', (error) => {
          if (!this.isCurrentTransport(currentAttempt, currentPeer)) return;
          const unavailable = error && error.type === 'peer-unavailable';
          if (this.authenticated && this.connection?.open) {
            this.setStatus(unavailable ? 'Pairing host unavailable; data channel retained' : 'Signaling error; data channel retained');
            return;
          }
          this.handleDisconnect(
            unavailable ? 'Pairing host is unavailable' : 'Signaling connection failed',
            false,
            currentAttempt,
            currentPeer,
          );
        });
      }).catch((error) => {
        if (this.attempt === currentAttempt && !this.terminal) {
          this.handleConnectFailure('Peer runtime unavailable', currentAttempt, error);
        }
      });
    }

    isCurrentTransport(attempt, peer, connection = null) {
      return !this.terminal
        && this.attempt === attempt
        && this.peer === peer
        && (connection === null || this.connection === connection);
    }

    handleConnectFailure(message, attempt, error) {
      if (this.terminal || this.attempt !== attempt) return;
      // A signaling reconnect can throw after PeerJS has already created a
      // data channel. Retire both owners through the same fenced disposer;
      // merely nulling the references leaks the old Peer/RTC transport while
      // the retry timer starts a second owner.
      this.disposeTransport();
      this.authenticated = false;
      this.connected = false;
      this.setStatus(message);
      if (error) console.warn('Remote Peer transport could not be created', error);
      this.scheduleReconnect();
    }

    async handleMessage(data, attempt, peer, connection) {
      if (!this.isCurrentTransport(attempt, peer, connection)) return;
      if (!isObject(data)
        || data.protocolVersion !== REMOTE_PROTOCOL_VERSION
        || data.sessionId !== this.pairing.sessionId) return;

      if (data.type === 'spectra.remote.challenge') {
        if (this.authenticated || !isRemoteChallengeMessage(data)) return;
        if (Date.now() > data.pairingExpiresAt) {
          this.handleDisconnect('Pairing has expired', true);
          return;
        }
        try {
           const proof = await createRemoteProof(this.pairing.secret, this.pairing.sessionId, data.nonce);
           if (this.isCurrentTransport(attempt, peer, connection)
             && !this.authenticated
             && connection.open) {
             connection.send({
              type: 'spectra.remote.authenticate',
              protocolVersion: REMOTE_PROTOCOL_VERSION,
              sessionId: this.pairing.sessionId,
              proof,
            });
          }
         } catch {
           this.handleDisconnect(
             'Authentication is unavailable in this browser',
             true,
             attempt,
             peer,
             connection,
           );
        }
        return;
      }

       if (data.type === 'spectra.remote.auth-result' && isRemoteAuthResultMessage(data)) {
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
        this.sessionEpoch = data.sessionEpoch;
        this.pairing.authenticatedOnce = true;
        this.retryCount = 0;
        this.reconnectDeadline = 0;
        this.sequence = 0;
        window.clearTimeout(this.connectTimer);
        this.setStatus('Authenticated and connected');
        savePairings();
        return;
      }

       if (data.type === 'spectra.remote.state'
         && this.authenticated
         && data.sessionEpoch === this.sessionEpoch
         && isRemoteStateMessage(data)) {
		if (data.generation < this.generation
			|| (data.generation === this.generation && data.revision < this.revision)) return;
        this.generation = data.generation;
		this.revision = data.revision;
        this.state = {
          volume: Math.round(Math.max(0, Math.min(800, data.volume)) * 10) / 10,
		  volumeBase: Math.round(data.volumeBase),
		  boost: Math.round(data.boost * 10) / 10,
		  actualMode: data.actualMode,
		  phase: data.phase,
		  volumeState: data.volumeState,
          muted: data.muted,
          playing: data.playing,
		  speed: Math.max(0.1, Math.min(16, data.speed)),
          tabTitle: cleanText(data.tabTitle, 512),
          tabDomain: cleanText(data.tabDomain, 253),
        };
        render();
        return;
      }

       if (data.type === 'spectra.remote.closed'
         && this.authenticated
         && data.sessionEpoch === this.sessionEpoch
         && isRemoteClosedMessage(data)) {
         this.handleDisconnect(closeReasonMessage(data.reason), true, attempt, peer, connection);
      }
    }

    sendCommand(command) {
      if (!this.authenticated
        || !this.connection?.open
        || !Number.isSafeInteger(this.sessionEpoch)
        || this.sessionEpoch <= 0
        || !isRemoteCommand(command)
        || !isSessionId(this.pairing.sessionId)) return;
      this.sequence += 1;
      try {
        this.connection.send({
          type: 'spectra.remote.command',
          protocolVersion: REMOTE_PROTOCOL_VERSION,
          sessionId: this.pairing.sessionId,
          sessionEpoch: this.sessionEpoch,
          commandId: generateRandomToken(16),
          sequence: this.sequence,
          generation: this.generation,
          command,
        });
      } catch {
        this.handleDisconnect('Data channel error');
      }
    }

    handleDisconnect(message, isTerminal = false, attempt = this.attempt, peer = this.peer, connection = null) {
      if (!this.isCurrentTransport(attempt, peer, connection)) return;
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

      this.scheduleReconnect();
    }

    scheduleReconnect() {
      if (this.terminal) return;
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

      if (this.retryTimer !== null) return;

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
      const failures = [];
      try {
        oldConnection?.close();
      } catch (error) {
        failures.push(error);
      }
      try {
        oldPeer?.destroy();
      } catch (error) {
        failures.push(error);
      }
      if (failures.length > 0) {
        console.error('Remote transport disposal failed', new AggregateError(failures));
      }
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
    if (!existing && sessions.size >= MAX_PAIRINGS) return false;
    if (existing) {
      existing.pairing = { ...pairing };
      if (existing.terminal) existing.terminal = false;
    } else {
      sessions.set(pairing.sessionId, new RemoteSessionClient(pairing));
    }
    if (makeActive) activeSessionId = pairing.sessionId;
    return true;
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
      if (!addSession(pairing)) {
        pairingError.textContent = `A maximum of ${MAX_PAIRINGS} pairings can be kept.`;
        return;
      }
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
    return value && value.protocolVersion === REMOTE_PROTOCOL_VERSION
      && isSessionId(value.sessionId)
      && isRemotePeerId(value.peerId)
      && isSessionId(value.secret)
      && (value.createdAt === undefined
        || (Number.isSafeInteger(value.createdAt) && value.createdAt >= 0))
      && Number.isSafeInteger(value.pairingExpiresAt)
      && value.pairingExpiresAt >= 0
      && (value.createdAt === undefined || value.pairingExpiresAt > value.createdAt)
      && (value.authenticatedOnce === undefined || typeof value.authenticatedOnce === 'boolean');
  }

  function loadPairings() {
    try {
      const values = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(values) ? boundPairings(values.filter(isPairing)) : [];
    } catch {
      return [];
    }
  }

  function savePairings() {
    const values = boundPairings([...sessions.values()]
      .filter((client) => !client.terminal && isPairing(client.pairing))
      .map((client) => client.pairing));
    const serialized = JSON.stringify(values);
    try {
      sessionStorage.setItem(STORAGE_KEY, serialized);
    } catch (error) {
      // Persistence is optional; never tear down a live authenticated transport
      // just because this tab exhausted its Web Storage quota.
      console.warn('Remote pairing persistence unavailable', error);
      try {
        sessionStorage.removeItem(STORAGE_KEY);
        try {
          sessionStorage.setItem(STORAGE_KEY, serialized);
        } catch (retryError) {
          console.warn('Remote pairing persistence retry failed', retryError);
        }
      } catch (removeError) {
        console.warn('Remote pairing persistence could not recover', removeError);
      }
    }
  }

  function boundPairings(values) {
    const unique = [];
    const seen = new Set();
    for (const pairing of values) {
      if (seen.has(pairing.sessionId)) continue;
      seen.add(pairing.sessionId);
      unique.push(pairing);
    }
    while (unique.length > MAX_PAIRINGS) unique.shift();
    while (unique.length > 0 && encodedByteLength(JSON.stringify(unique)) > MAX_PAIRING_STORAGE_BYTES) {
      unique.shift();
    }
    return unique;
  }

  function encodedByteLength(value) {
    return new TextEncoder().encode(value).byteLength;
  }

  function upsertPairing(values, pairing) {
    const index = values.findIndex((item) => item.sessionId === pairing.sessionId);
    if (index >= 0) values[index] = pairing;
    else {
      values.push(pairing);
      while (values.length > MAX_PAIRINGS) values.shift();
    }
  }

  function formatVolume(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
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
