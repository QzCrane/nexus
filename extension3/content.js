(function() {
    if (window.VMInjected) return;
    window.VMInjected = true;

    // --- 原有变量 ---
    let ctx, source, gain, comp, bass, analyser, eqNodes = [];
    let isConnected = false;
    let config = { enabled: true, volume: 100, muted: false, compressor: false, mono: false, bass: false, eqValues: [0,0,0,0,0,0,0,0,0,0] };
    let globalSettings = { osdEnabled: true, lang: 'en-US' };
    let osdContainer = null;
    let osdTimer = null;
    let isPopupOpen = false;

    // --- 新增变量：状态标记 ---
    let isCaptureActive = false; // 由 Background 控制

    // ============================================
    // 1. 新增：全屏 API 劫持 (用于 Capture 模式)
    // ============================================
    const nativeRequestFullscreen = Element.prototype.requestFullscreen;
    const nativeExitFullscreen = Document.prototype.exitFullscreen;

    Element.prototype.requestFullscreen = function(options) {
        if (isCaptureActive) {
            // 劫持！执行伪全屏
            const container = this.closest('.xgplayer-container, .bilibili-player-area, .html5-video-player') || this;
            enterFakeFullscreen(container);
            return Promise.resolve();
        }
        return nativeRequestFullscreen.apply(this, arguments);
    };

    Document.prototype.exitFullscreen = function() {
        if (document.body.classList.contains('vm-fake-fs')) {
            exitFakeFullscreen();
            return Promise.resolve();
        }
        return nativeExitFullscreen.apply(this, arguments);
    };

    // 伪全屏 CSS (动态注入)
    const fsStyle = document.createElement('style');
    fsStyle.innerHTML = `
        body.vm-fake-fs { overflow: hidden !important; }
        .vm-fs-target { position: fixed !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100vh !important; z-index: 2147483647 !important; background: #000 !important; object-fit: contain !important; }
        .vm-fs-target .xgplayer-controls, .vm-fs-target .bilibili-player-video-control, .vm-fs-target .ytp-chrome-bottom { z-index: 2147483648 !important; position: absolute !important; }
    `;
    (document.head || document.documentElement).appendChild(fsStyle);

    function enterFakeFullscreen(el) {
        el.classList.add('vm-fs-target');
        document.body.classList.add('vm-fake-fs');
        el.dispatchEvent(new Event('fullscreenchange', { bubbles: true }));
    }
    function exitFakeFullscreen() {
        document.querySelectorAll('.vm-fs-target').forEach(el => el.classList.remove('vm-fs-target'));
        document.body.classList.remove('vm-fake-fs');
        document.dispatchEvent(new Event('fullscreenchange', { bubbles: true }));
    }
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.body.classList.contains('vm-fake-fs')) exitFakeFullscreen();
    }, true);


    // ============================================
    // 2. 原有逻辑：WebAudio 初始化与管理
    // ============================================
    try {
        chrome.runtime.onConnect.addListener((port) => {
            if (port.name === "popup-connection") {
                isPopupOpen = true;
                port.onDisconnect.addListener(() => { isPopupOpen = false; });
            }
        });
    } catch(e) {}

    const observer = new MutationObserver((mutations) => {
        let found = false;
        mutations.forEach(m => { m.addedNodes.forEach(n => { if (n.nodeName === 'VIDEO' || n.nodeName === 'AUDIO') found = true; }); });
        if(found) setTimeout(scan, 500);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    function scan() { document.querySelectorAll('video, audio').forEach(initAudio); }

    function initAudio(el) {
        if (el.dataset.vmAttached) return;
        el.dataset.vmAttached = "true";
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!ctx) ctx = new AC();
            try { source = ctx.createMediaElementSource(el); } 
            catch (e) { 
                if (el.captureStream || el.mozCaptureStream) {
                     const s = el.captureStream ? el.captureStream() : el.mozCaptureStream();
                     source = ctx.createMediaStreamSource(s);
                } else return;
            }
            gain = ctx.createGain();
            bass = ctx.createBiquadFilter(); bass.type = 'lowshelf'; bass.frequency.value = 200;
            comp = ctx.createDynamicsCompressor();
            analyser = ctx.createAnalyser(); analyser.fftSize = 256;
            eqNodes = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map(f => {
                const n = ctx.createBiquadFilter(); n.type = 'peaking'; n.frequency.value = f; n.Q.value = 1.4; return n;
            });
            isConnected = true;
            applyState();
            const resume = () => { if(ctx.state==='suspended') ctx.resume(); applyState(); };
            el.addEventListener('play', resume);
            el.addEventListener('canplay', resume);
        } catch (e) {}
    }

    function applyState() {
        // 如果是 Capture 模式，本地静音逻辑会有变化
        // 但为了简单，我们保持原有逻辑，只是在 Capture 模式下 Background 会处理声音
        // Capture 模式下 TabCapture 会自动 mute 掉 tab 的输出流，所以这里不需要特意 mute
        
        if (!ctx || !source) return; // 如果WebAudio没初始化成功（如Douyin），这里会返回
        
        // --- 针对 Douyin 的降级处理 ---
        // 如果 WebAudio 失败，我们通过 DOM volume 控制 (仅在 < 100% 时有效)
        // 如果 > 100% 且 WebAudio 失败，声音由 Background Capture 接管，这里只需保持 video 播放
        
        const t = ctx.currentTime; const r = 0.05;

        if (!config.enabled) {
            try { source.disconnect(); } catch(e){}
            source.connect(ctx.destination);
            return;
        }
        try { source.disconnect(); } catch(e){}
        
        let head = source;
        head.connect(gain); head = gain;
        head.connect(bass); head = bass;
        eqNodes.forEach(n => { head.connect(n); head = n; });
        head.connect(comp); head = comp;
        head.connect(analyser); 
        analyser.connect(ctx.destination);

        const v = config.muted ? 0 : (config.volume / 100);
        
        // 如果是 Capture 模式，这里的 gain 设置其实不重要（因为输出被静音了），但为了波形最好保持
        gain.gain.setTargetAtTime(v, t, r);
        
        gain.channelCount = config.mono ? 1 : 2;
        gain.channelCountMode = config.mono ? 'explicit' : 'max';
        bass.gain.setTargetAtTime(config.bass ? 10 : 0, t, r);
        
        if (config.compressor) {
            comp.threshold.setTargetAtTime(-20, t, r);
            comp.knee.setTargetAtTime(10, t, r); 
            comp.ratio.setTargetAtTime(4, t, r);
            comp.attack.setTargetAtTime(0.003, t, r);
            comp.release.setTargetAtTime(0.25, t, r);
        } else {
            comp.threshold.setTargetAtTime(0, t, r);
            comp.ratio.setTargetAtTime(1, t, r);
        }
        eqNodes.forEach((n, i) => n.gain.setTargetAtTime(config.eqValues[i], t, r));
    }

    // --- 原有 showOSD 保持不变 ---
    function showOSD() {
        if (!config.enabled || !globalSettings.osdEnabled || isPopupOpen) return;
        if (!osdContainer) {
            const host = document.createElement('div');
            host.style.cssText = "position: fixed; top: 15%; left: 50%; transform: translateX(-50%); z-index: 2147483647; pointer-events: none;";
            document.body.appendChild(host);
            const shadow = host.attachShadow({mode: 'open'});
            shadow.innerHTML = `
                <style>
                    .osd-card { background: rgba(255, 255, 255, 0.9); backdrop-filter: blur(8px); padding: 10px 18px; border-radius: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); display: flex; align-items: center; gap: 10px; font-family: system-ui, sans-serif; opacity: 0; transform: translateY(-5px); transition: all 0.15s ease-out; border: 1px solid rgba(255,255,255,0.4); }
                    .osd-card.visible { opacity: 1; transform: translateY(0); }
                    .icon { font-size: 18px; }
                    .bar-rail { width: 120px; height: 5px; background: #e2e8f0; border-radius: 3px; overflow: hidden; }
                    .bar-fill { height: 100%; background: #2563eb; width: 0%; transition: width 0.08s; }
                    .text { font-size: 13px; font-weight: 700; color: #2563eb; min-width: 36px; text-align: right; }
                    .muted .bar-fill { background: #94a3b8; }
                    .muted .text { color: #94a3b8; }
                </style>
                <div class="osd-card" id="card"><div class="icon" id="icon">🔊</div><div class="bar-rail"><div class="bar-fill" id="fill"></div></div><div class="text" id="val">100%</div></div>
            `;
            osdContainer = shadow;
        }
        const card = osdContainer.getElementById('card');
        const fill = osdContainer.getElementById('fill');
        const val = osdContainer.getElementById('val');
        const icon = osdContainer.getElementById('icon');
        const isMuted = config.muted;
        card.classList.toggle('muted', isMuted);
        fill.style.width = (config.volume / 800 * 100) + '%';
        val.innerText = isMuted ? 'MUTE' : config.volume + '%';
        icon.innerText = isMuted ? '🔇' : '🔊';
        card.classList.remove('visible'); void card.offsetWidth; card.classList.add('visible');
        clearTimeout(osdTimer); osdTimer = setTimeout(() => card.classList.remove('visible'), 500);
    }

    // --- 消息监听 (更新) ---
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.action === "getStatus") {
            const els = document.querySelectorAll('video, audio');
            sendResponse({ config, hasAudio: els.length > 0 });
        }
        else if (msg.action === "updateConfig") {
            config = { ...config, ...msg.config };
            applyState();
            // 同时更新 DOM 音量，作为 Safe Mode 的 fallback
            document.querySelectorAll('video, audio').forEach(el => {
                if(isCaptureActive) { el.volume = 1; el.muted = false; } // Capture 模式下保持源声音
                else { el.volume = Math.min(1, config.volume / 100); el.muted = config.muted; }
            });
        }
        else if (msg.action === "globalSettingsUpdate") {
            globalSettings = { ...globalSettings, ...msg.settings };
        }
        else if (msg.action === "getVisualizerData") {
            // 如果是 Capture 模式，直接返回 null，让 Popup 去找 Offscreen 要数据
            if (isCaptureActive) { sendResponse({ buffer: null }); return; }
            
            if (!analyser) return sendResponse({ buffer: null });
            const data = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(data);
            sendResponse({ buffer: Array.from(data) });
        }
        else if (msg.action === "shortcutTrigger") {
             if(!config.enabled) return;
             if (msg.command === "volume_up") config.volume = Math.min(config.volume + 10, 800);
             if (msg.command === "volume_down") config.volume = Math.max(config.volume - 10, 0);
             if (msg.command === "toggle_mute") config.muted = !config.muted;
             applyState();
             showOSD();
             try { chrome.runtime.sendMessage({ action: "syncUI", config }); } catch(e) {}
        }
        else if (msg.action === "captureStateChange") {
            isCaptureActive = msg.enabled;
            // 状态改变，重新强制应用音量策略
            document.querySelectorAll('video, audio').forEach(el => {
                if(isCaptureActive) { el.volume = 1; el.muted = false; }
                else { el.volume = Math.min(1, config.volume / 100); el.muted = config.muted; }
            });
        }
    });

    chrome.storage.local.get(['siteSettings', 'globalSettings'], (res) => {
        if (res.siteSettings?.[location.hostname]) config = res.siteSettings[location.hostname];
        if (res.globalSettings) globalSettings = res.globalSettings;
        scan();
    });
})();