(function() {
    if (window.VMInjected) return;
    window.VMInjected = true;

    let ctx, source, gain, comp, bass, analyser, eqNodes = [];
    let isConnected = false;
    let config = { enabled: true, volume: 100, muted: false, compressor: false, mono: false, bass: false, eqValues: [0,0,0,0,0,0,0,0,0,0] };
    let globalSettings = { osdEnabled: true, lang: 'en-US' };
    let osdContainer = null;
    let osdTimer = null;
    let isPopupOpen = false;

    // 安全连接
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
        mutations.forEach(m => {
            m.addedNodes.forEach(n => {
                if (n.nodeName === 'VIDEO' || n.nodeName === 'AUDIO') found = true;
            });
        });
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
        if (!ctx || !source) return;
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

    function showOSD() {
        if (!config.enabled || !globalSettings.osdEnabled || isPopupOpen) return;
        
        if (!osdContainer) {
            const host = document.createElement('div');
            host.style.cssText = "position: fixed; top: 15%; left: 50%; transform: translateX(-50%); z-index: 2147483647; pointer-events: none;";
            document.body.appendChild(host);
            const shadow = host.attachShadow({mode: 'open'});
            
            shadow.innerHTML = `
                <style>
                    .osd-card {
                        background: rgba(255, 255, 255, 0.9); backdrop-filter: blur(8px);
                        padding: 10px 18px; border-radius: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);
                        display: flex; align-items: center; gap: 10px; font-family: system-ui, sans-serif;
                        opacity: 0; transform: translateY(-5px); transition: all 0.15s ease-out;
                        border: 1px solid rgba(255,255,255,0.4);
                    }
                    .osd-card.visible { opacity: 1; transform: translateY(0); }
                    .icon { font-size: 18px; }
                    .bar-rail { width: 120px; height: 5px; background: #e2e8f0; border-radius: 3px; overflow: hidden; }
                    .bar-fill { height: 100%; background: #2563eb; width: 0%; transition: width 0.08s; }
                    .text { font-size: 13px; font-weight: 700; color: #2563eb; min-width: 36px; text-align: right; }
                    .muted .bar-fill { background: #94a3b8; }
                    .muted .text { color: #94a3b8; }
                </style>
                <div class="osd-card" id="card">
                    <div class="icon" id="icon">🔊</div>
                    <div class="bar-rail"><div class="bar-fill" id="fill"></div></div>
                    <div class="text" id="val">100%</div>
                </div>
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

        card.classList.remove('visible');
        void card.offsetWidth; 
        card.classList.add('visible');
        clearTimeout(osdTimer);
        osdTimer = setTimeout(() => card.classList.remove('visible'), 500);
    }

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.action === "getStatus") {
            const els = document.querySelectorAll('video, audio');
            sendResponse({ config, hasAudio: els.length > 0 });
        }
        else if (msg.action === "updateConfig") {
            config = { ...config, ...msg.config };
            applyState();
        }
        else if (msg.action === "globalSettingsUpdate") {
            globalSettings = { ...globalSettings, ...msg.settings };
        }
        else if (msg.action === "getVisualizerData") {
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
    });

    chrome.storage.local.get(['siteSettings', 'globalSettings'], (res) => {
        if (res.siteSettings?.[location.hostname]) config = res.siteSettings[location.hostname];
        if (res.globalSettings) globalSettings = res.globalSettings;
        scan();
    });
})();