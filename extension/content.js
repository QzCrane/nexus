(function() {
    if (window.VMInjected) return;
    window.VMInjected = true;

    // ============================================
    // 1. Constants & State
    // ============================================
    const STRATEGY = { NATIVE: 'NATIVE', CAPTURE: 'CAPTURE' };
    const DEFAULT_REGISTRY = {
        'douyin.com': STRATEGY.CAPTURE,
        'live.douyin.com': STRATEGY.CAPTURE,
        'netflix.com': STRATEGY.CAPTURE,
        'spotify.com': STRATEGY.CAPTURE,
        'youtube.com': STRATEGY.NATIVE,
        'bilibili.com': STRATEGY.NATIVE
    };

    let ctx; 
    let activeAnalyser = null;
    let SITE_REGISTRY = { ...DEFAULT_REGISTRY };
    
    // Core Config
    let config = { enabled: true, volume: 100, muted: false, compressor: false, mono: false, bass: false, eqValues: [0,0,0,0,0,0,0,0,0,0] };
    let globalSettings = { osdEnabled: true, lang: 'en-US' };
    let currentStrategy = STRATEGY.NATIVE;
    let isCaptureActive = false; // Synced from background
    let isFallbackMode = false;  // NEW: Indicates we are in Capture Strategy but Capture failed (Waiting for Gesture)
    
    // UI State
    let isPopupOpen = false;
    let osdContainer = null;
    let osdTimer = null;

    // Load Settings
    chrome.storage.local.get(['userRegistry', 'siteSettings', 'globalSettings'], (res) => {
        if (res.userRegistry) res.userRegistry.forEach(d => SITE_REGISTRY[d] = STRATEGY.CAPTURE);
        if (res.siteSettings?.[location.hostname]) config = res.siteSettings[location.hostname];
        if (res.globalSettings) globalSettings = res.globalSettings;
        init();
        showOSD(); // Test OSD
    });

    try {
        chrome.runtime.onConnect.addListener((port) => {
             if (port.name === "popup-connection") {
                 isPopupOpen = true;
                 port.onDisconnect.addListener(() => isPopupOpen = false);
             }
        });
    } catch(e){}

    // ============================================
    // 2. Strategy Engine
    // ============================================
    function determineStrategy(hostname) {
        for (const [domain, strategy] of Object.entries(SITE_REGISTRY)) {
            if (hostname.includes(domain)) return strategy;
        }
        return STRATEGY.NATIVE;
    }

    function fastCorsCheck(el) {
        if (currentStrategy === STRATEGY.CAPTURE) return false;

        const src = el.currentSrc || el.src;
        if (!src) return true;
        if (src.startsWith('blob:') || src.startsWith('data:')) return true;

        try {
            const srcUrl = new URL(src);
            if (srcUrl.hostname === window.location.hostname) return true;
            if (el.crossOrigin && el.crossOrigin.toLowerCase() === 'anonymous') return true;

            // CORS Failure detected
            console.warn("[VM] CORS Conflict -> Switching to CAPTURE", src);
            const domain = window.location.hostname;
            chrome.storage.local.get(['userRegistry'], (r) => {
                const list = r.userRegistry || [];
                if (!list.includes(domain)) {
                     chrome.storage.local.set({ userRegistry: [...list, domain] });
                }
            });
            switchStrategy(STRATEGY.CAPTURE);
            showToast("Detected CORS - Switched to Capture Mode");
            return false;
        } catch(e) {
            return true;
        }
    }

    function switchStrategy(newStrategy) {
        if (currentStrategy === newStrategy) return;
        currentStrategy = newStrategy;
        if (newStrategy === STRATEGY.CAPTURE) activateCaptureMode();
        else {
             scan();
        }
    }

    // ============================================
    // 3. Initialization & Scanning
    // ============================================
    // ============================================
    // 3. Initialization & Scanning
    // ============================================
    function init() {
        currentStrategy = determineStrategy(window.location.hostname);
        
        // Performance: Debounce scan to avoid UI lag on high-freq DOM updates (e.g. Douyin comments)
        const debouncedScan = debounce(scan, 500);
        const observer = new MutationObserver((mutations) => { debouncedScan(); });
        observer.observe(document.documentElement, { childList: true, subtree: true });
        
        scan();
        
        // Sync Capture State on Load (Fixes "Blue Bar after Refresh" bug)
        chrome.runtime.sendMessage({ action: "getCaptureState" }, (isActive) => {
            if (isActive) {
                isCaptureActive = true;
                applyState();
            }
        });

        ['click', 'keydown', 'mousedown', 'touchstart', 'scroll'].forEach(evt => 
            document.addEventListener(evt, () => { if(ctx && ctx.state === 'suspended') ctx.resume(); }, {passive:true})
        );
    }
    
    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    function scan() { document.querySelectorAll('video, audio').forEach(initAudio); }

    // ... (rest of initAudio) ...



    function initAudio(el) {
        if (el.dataset.vmAttached) return;
        
        // Immediate check strategy
        if (currentStrategy === STRATEGY.CAPTURE) {
            activateCaptureMode();
            el.dataset.vmAttached = "true";
            // Even in capture mode (or fallback), we might want to ensure volume is applied
            applyState();
            return;
        }

        if (!fastCorsCheck(el)) return;

        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!ctx) ctx = new AC();
            if (ctx.state === 'suspended') ctx.resume();

            let source;
            try { 
                source = ctx.createMediaElementSource(el); 
            } catch (e) {
                switchStrategy(STRATEGY.CAPTURE);
                return;
            }

            const gain = ctx.createGain(); 
            const bass = ctx.createBiquadFilter(); bass.type = 'lowshelf'; bass.frequency.value = 200;
            const comp = ctx.createDynamicsCompressor();
            const analyser = ctx.createAnalyser(); analyser.fftSize = 256;
            const eqNodes = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map(f => {
                const n = ctx.createBiquadFilter(); n.type = 'peaking'; n.frequency.value = f; n.Q.value = 1.4; return n;
            });

            // CONNECT CHAIN: Source -> Gain -> Bass -> EQ -> Comp -> Analyser -> Dest
            let head = source;
            head.connect(gain); head = gain;
            head.connect(bass); head = bass;
            eqNodes.forEach(n => { head.connect(n); head = n; });
            head.connect(comp); head = comp;
            head.connect(analyser); 
            analyser.connect(ctx.destination);

            el._vm = { source, gain, bass, comp, eqNodes, analyser };
            el.dataset.vmAttached = "true";
            activeAnalyser = analyser;

            const resume = () => { 
                if(ctx.state === 'suspended') ctx.resume(); 
                activeAnalyser = analyser;
                applyStateToElement(el); 
            };
            el.addEventListener('play', resume);
            el.addEventListener('playing', resume);
            
            el.addEventListener('volumechange', () => {
                if (currentStrategy === STRATEGY.NATIVE && !isCaptureActive && !config.muted && !isFallbackMode) {
                    if (Math.abs(el.volume - 1) > 0.01 || el.muted) {
                        el.volume = 1;
                        el.muted = false;
                    }
                }
            });

            applyStateToElement(el);
            el.volume = 1;
            el.muted = false;

        } catch (e) {
            console.error(e);
        }
    }

    // ============================================
    // 4. Core Logic (Updated for Fallback)
    // ============================================
    function applyState() {
        // CASE 1: Active Capture. Lock Native to 100%.
        if (isCaptureActive) {
            document.querySelectorAll('video, audio').forEach(el => {
                 if (el.muted && !config.muted) el.muted = false;
                 if (el.volume !== 1) el.volume = 1; 
            });
            return;
        }

        // CASE 2: Fallback Mode (Capture needed but not active). Use Native Volume 0-100%.
        // This solves the "First Load" issue.
        if (currentStrategy === STRATEGY.CAPTURE && !isCaptureActive) {
            isFallbackMode = true; // Mark as fallback
            const fallbackVol = config.muted ? 0 : Math.min(1, config.volume / 100);
            document.querySelectorAll('video, audio').forEach(el => {
                // Only touch if significant diff to prevent fighting native controls
                if (Math.abs(el.volume - fallbackVol) > 0.01) el.volume = fallbackVol;
                if (el.muted !== config.muted) el.muted = config.muted;
            });
            return;
        }
        
        isFallbackMode = false;
        
        // CASE 3: Native WebAudio Strategy
        if (ctx && ctx.state === 'suspended') ctx.resume();
        document.querySelectorAll('video, audio').forEach(applyStateToElement);
    }

    function applyStateToElement(el) {
        if (!el._vm) return;
        const { gain, bass, comp, eqNodes } = el._vm;
        const t = ctx.currentTime;
        const r = 0.05;

        if (!config.enabled) {
            gain.gain.setTargetAtTime(1, t, r);
            bass.gain.setTargetAtTime(0, t, r);
            eqNodes.forEach(n => n.gain.setTargetAtTime(0, t, r));
            comp.threshold.setTargetAtTime(-3, t, r); 
            comp.ratio.setTargetAtTime(1, t, r);
            return;
        }

        const v = config.muted ? 0 : (config.volume / 100);
        gain.gain.setTargetAtTime(v, t, r);
        bass.gain.setTargetAtTime(config.bass ? 10 : 0, t, r);
        gain.channelCount = config.mono ? 1 : 2;
        gain.channelCountMode = config.mono ? 'explicit' : 'max';

        if (config.compressor) {
            comp.threshold.setTargetAtTime(-24, t, r);
            comp.ratio.setTargetAtTime(12, t, r);
        } else {
            comp.threshold.setTargetAtTime(-3, t, r);
            comp.ratio.setTargetAtTime(20, t, r);
        }
        eqNodes.forEach((n, i) => n.gain.setTargetAtTime(config.eqValues[i], t, r));
    }

    function activateCaptureMode() {
        if (isCaptureActive) return;
        // Attempt to start capture. If it fails (no gesture), Background will send CAPTURE_NEEDS_GESTURE
        chrome.runtime.sendMessage({ action: "toggleCapture", enabled: true, config: config, forceStrategy: true });
    }

    // ============================================
    // 5. Messages
    // ============================================
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.action === "getStatus") {
             const els = document.querySelectorAll('video, audio');
             let mode = (isCaptureActive || currentStrategy === STRATEGY.CAPTURE) ? 'CAPTURE' : 'NATIVE';
             sendResponse({ config, hasAudio: els.length > 0, mode });
        }
        else if (msg.action === "updateConfig") {
            config = { ...config, ...msg.config };
            
            // If we are in Fallback Mode, ANY user interaction (like changing volume via popup) 
            // is a valid user gesture. So we RETRY capture immediately!
            if (isFallbackMode) {
                activateCaptureMode();
            }
            
            applyState();
            if (isCaptureActive) chrome.runtime.sendMessage({ action: "updateCaptureConfig", config }).catch(()=>{});
        }
        else if (msg.action === "captureStateChange") {
            isCaptureActive = msg.enabled;
            if (isCaptureActive) isFallbackMode = false;
            applyState();
        }
        else if (msg.action === "CAPTURE_NEEDS_GESTURE") {
            // Background says: "I tried, but I need a user gesture."
            // So we stay in Fallback Mode. We don't spam toasts.
            isFallbackMode = true;
            console.log("[VM] Capture Waiting for Gesture (Fallback Mode Active)");
            applyState();
        }
        else if (msg.action === "shortcutTrigger") {
            if(!config.enabled) return;
            if (msg.command === "volume_up") config.volume = Math.min(config.volume + 10, 800);
            if (msg.command === "volume_down") config.volume = Math.max(config.volume - 10, 0);
            if (msg.command === "toggle_mute") config.muted = !config.muted;
            
            // Shortcut is a USER GESTURE. Retry capture!
            if (isFallbackMode) {
                activateCaptureMode();
                showOSD(); // Optimization: Show OSD makes it feel responsive
            } else {
                applyState();
                showOSD();
            }
            
            // CRITICAL FIX: Sync volume change to Offscreen audio processor if capturing!
            if (isCaptureActive) {
                chrome.runtime.sendMessage({ action: "updateCaptureConfig", config }).catch(()=>{});
            }
            
            try { chrome.runtime.sendMessage({ action: "syncUI", config }); } catch(e){}
        }
        else if (msg.action === "showToast") {
             showToast(msg.text);
        }
        else if (msg.action === "getVisualizerData") {
            if (activeAnalyser) {
                const data = new Uint8Array(activeAnalyser.frequencyBinCount);
                activeAnalyser.getByteFrequencyData(data);
                sendResponse({ buffer: Array.from(data) });
            } else {
                sendResponse({ buffer: null });
            }
        }
    });

    // ============================================
    // 6. UI Helpers
    // ============================================
    const nativeRequestFullscreen = Element.prototype.requestFullscreen;
    Element.prototype.requestFullscreen = function(options) {
        if (isCaptureActive) {
            const container = this.closest('.xgplayer-container, .bilibili-player-area, .html5-video-player') || this;
            enterFakeFullscreen(container);
            return Promise.resolve();
        }
        return nativeRequestFullscreen.apply(this, arguments);
    };
    function enterFakeFullscreen(el) { el.classList.add('vm-fs-target'); document.body.classList.add('vm-fake-fs'); el.dispatchEvent(new Event('fullscreenchange', { bubbles: true })); }
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('vm-fake-fs')) exitFakeFullscreen(); }, true);
    function exitFakeFullscreen() { 
        document.querySelectorAll('.vm-fs-target').forEach(el => el.classList.remove('vm-fs-target')); 
        document.body.classList.remove('vm-fake-fs'); 
        document.dispatchEvent(new Event('fullscreenchange', { bubbles: true }));
    }
    const fsStyle = document.createElement('style');
    fsStyle.innerHTML = `body.vm-fake-fs { overflow: hidden !important; } .vm-fs-target { position: fixed !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100vh !important; z-index: 2147483647 !important; background: #000 !important; }`;
    (document.head || document.documentElement).appendChild(fsStyle);

    function showToast(text) {
        const div = document.createElement('div');
        div.style.cssText = "position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: #222; color: #fff; padding: 6px 12px; border-radius: 4px; font-size: 13px; z-index: 2147483647; font-family: sans-serif;";
        div.textContent = text;
        document.body.appendChild(div);
        setTimeout(() => div.remove(), 2500);
    }

    function showOSD() {
        if (isPopupOpen || !config.enabled || !globalSettings.osdEnabled) return;
        if (!osdContainer) {
            const host = document.createElement('div');
            host.style.cssText = "position: fixed; top: 15%; left: 50%; transform: translateX(-50%); z-index: 2147483647; pointer-events: none;";
            document.body.appendChild(host);
            const shadow = host.attachShadow({mode: 'open'});
            shadow.innerHTML = `
                <style>
                    .osd { background: rgba(20,20,30,0.85); backdrop-filter: blur(8px); padding: 12px 20px; border-radius: 30px; color: white; display: flex; align-items: center; gap: 12px; font-family: system-ui, sans-serif; transition: opacity 0.2s, transform 0.2s; opacity: 0; transform: translateY(-10px); box-shadow: 0 4px 15px rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); }
                    .osd.visible { opacity: 1; transform: translateY(0); }
                    .bar-bg { width: 120px; height: 6px; background: rgba(255,255,255,0.2); border-radius: 3px; overflow: hidden; position: relative; }
                    .bar-fill { height: 100%; background: #3b82f6; width: 0%; transition: width 0.05s linear; border-radius: 3px; }
                    .marker { position: absolute; left: 12.5%; top: 0; bottom: 0; width: 2px; background: #fff; opacity: 0.8; z-index: 2; box-shadow: 0 0 2px rgba(0,0,0,0.5); }
                    .text { font-weight: 600; font-size: 14px; min-width: 40px; text-align: right; font-variant-numeric: tabular-nums; }
                    
                    /* ULTRA PRIORITY FIX of CSS Specificity */
                    /* Muted: Gray */
                    .osd.muted .bar-fill,
                    .osd.capture.muted .bar-fill { background: #9ca3af !important; }
                    
                    .osd.muted #icon { opacity: 0.6; } 
                    
                    /* Capture: Purple (Only if NOT muted) */
                    .osd.capture .bar-fill { background: #8b5cf6; }
                </style>
                <div class="osd" id="osd">
                    <span id="icon">🔊</span>
                    <div class="bar-bg">
                        <div class="marker"></div>
                        <div class="bar-fill" id="fill"></div>
                    </div>
                    <span class="text" id="val">100%</span>
                </div>
            `;
            osdContainer = shadow;
        }
        const osd = osdContainer.getElementById('osd');
        const fill = osdContainer.getElementById('fill');
        const val = osdContainer.getElementById('val');
        const icon = osdContainer.getElementById('icon');
        
        osd.className = 'osd visible';
        // Reset classes
        osd.classList.remove('capture', 'muted');
        
        // Visual Logic: If strategy is Capture, make it Purple (even in fallback), unless Muted
        if (isCaptureActive || currentStrategy === STRATEGY.CAPTURE) {
             osd.classList.add('capture');
        }
        
        const isActuallyMuted = config.muted || config.volume === 0;
        if (isActuallyMuted) osd.classList.add('muted');
        
        fill.style.width = Math.min(100, (config.volume / 800) * 100) + '%';
        val.innerText = isActuallyMuted ? 'MUTE' : config.volume + '%';
        
        if (isActuallyMuted) {
            icon.innerText = '🔇';
        } else {
            icon.innerText = config.volume > 100 ? '🚀' : '🔊';
        }

        clearTimeout(osdTimer);
        osdTimer = setTimeout(() => osd.classList.remove('visible'), 2000);
    }

})();
