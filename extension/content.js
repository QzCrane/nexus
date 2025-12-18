(function() {
    if (window.VMInjected) return;
    window.VMInjected = true;

    // ============================================
    // 1. Constants & Enums
    // ============================================
    const MODE = {
        NATIVE_WEBAUDIO: 'NATIVE_WEBAUDIO', // Used for Non-Restricted (YouTube), full features
        NATIVE_LITE: 'NATIVE_LITE',         // Used for Restricted (Douyin) + Viz OFF + Vol <= 100
        CAPTURE: 'CAPTURE'                  // Used for Restricted (Douyin) + (Viz ON OR Vol > 100)
    };

    const RESTRICTED_DOMAINS = [
        'douyin.com', 'live.douyin.com', 'netflix.com', 
        'spotify.com', 'disneyplus.com', 'hulu.com'
    ];

    // ============================================
    // 2. State & Config
    // ============================================
    let config = { enabled: true, volume: 100, muted: false, compressor: false, mono: false, bass: false, eqValues: [0,0,0,0,0,0,0,0,0,0] };
    let globalSettings = { osdEnabled: true, visualizerEnabled: true, lang: 'en-US' }; 
    let userRegistry = [];
    
    // Runtime State
    let ctx = null;            // AudioContext for NATIVE_WEBAUDIO
    let activeMode = null;     // The actual running mode
    let isCaptureActive = false; // The TRUE state from Background
    let isPendingCapture = false; // Lock to prevent spamming capture requests
    
    // ============================================
    // 3. Logic Engine (The Brain)
    // ============================================
    function isRestrictedSite() {
        const host = window.location.hostname;
        return RESTRICTED_DOMAINS.some(d => host.includes(d)) || userRegistry.includes(host);
    }

    /**
     * Calculates the DESIRED mode based on current config.
     * This is the single source of truth for strategy.
     */
    function calculateDesiredMode() {
        if (!config.enabled) return MODE.NATIVE_LITE; // Disabled -> Safe Lite Mode

        const restricted = isRestrictedSite();
        const vizOn = globalSettings.visualizerEnabled !== false; // Default to true if undefined
        const vol = config.volume;

        if (!restricted) {
            // Non-Restricted (YouTube): Always WebAudio
            return MODE.NATIVE_WEBAUDIO;
        } else {
            // Restricted (Douyin):
            if (vizOn) {
                // Strategy A: Viz ON -> Force Capture (Global Hijack)
                return MODE.CAPTURE;
            } else {
                // Strategy B: Viz OFF -> Hybrid
                if (vol > 100) return MODE.CAPTURE; // Need amplification -> Capture
                return MODE.NATIVE_LITE;            // Normal volume -> Native Lite
            }
        }
    }

    /**
     * Applies the calculated state.
     * Transitions modes and updates parameters.
     */
    function applyState() {
        const desired = calculateDesiredMode();
        
        // --- 1. Mode Transition ---
        if (desired !== activeMode) {
            console.log(`[VM] Mode Switch: ${activeMode} -> ${desired}`);
            
            // Cleanup Old Mode
            if (activeMode === MODE.NATIVE_WEBAUDIO) cleanupWebAudio();
            if (activeMode === MODE.CAPTURE && desired !== MODE.CAPTURE) requestCapture(false);

            activeMode = desired;
        }

        // --- 2. Mode Execution ---
        
        if (activeMode === MODE.CAPTURE) {
            // Requirement: Force Capture Active
            if (!isCaptureActive && !isPendingCapture) requestCapture(true);
            
            // DOM Audio Control:
            // In Capture Mode, the Tab is MUTED by Chrome (usually).
            // We set DOM elem to Volume 1.0 / Unmuted to ensure signal goes to TabCapture.
            // Volume control happens in Offscreen.
            document.querySelectorAll('video, audio').forEach(el => {
                // Avoid setting if already correct to prevent stutter
                if (Math.abs(el.volume - 1) > 0.01) el.volume = 1;
                if (el.muted) el.muted = false; 
            });
        } 
        
        else if (activeMode === MODE.NATIVE_LITE) {
            // Pure DOM Control
            const domVol = config.muted ? 0 : Math.min(1, config.volume / 100);
            document.querySelectorAll('video, audio').forEach(el => {
                if (Math.abs(el.volume - domVol) > 0.01) el.volume = domVol;
                if (el.muted !== config.muted) el.muted = config.muted;
            });
        }

        else if (activeMode === MODE.NATIVE_WEBAUDIO) {
            ensureWebAudio(); 
            updateWebAudioParams();
        }
    }

    // ============================================
    // 4. Controller (Actions)
    // ============================================
    function requestCapture(enabled) {
        if (isPendingCapture) return;
        isPendingCapture = true;
        
        console.log(`[VM] Requesting Capture: ${enabled}`);
        chrome.runtime.sendMessage({ 
            action: "toggleCapture", 
            enabled: enabled, 
            config: config 
        }, () => {
             // Unlock after a short delay to allow background to process
             setTimeout(() => { isPendingCapture = false; }, 500);
        });
    }

    // ============================================
    // 5. Audio Engine (Native WebAudio)
    // ============================================
    function cleanupWebAudio() {
        if (ctx) {
            try { ctx.close(); } catch(e){}
            ctx = null;
        }
        document.querySelectorAll('video, audio').forEach(el => {
            delete el._vm;
            el.dataset.vmAttached = "false";
        });
    }

    function ensureWebAudio() {
        if (ctx && ctx.state !== 'closed') {
             if (ctx.state === 'suspended') ctx.resume();
             return;
        }
        
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            ctx = new AC();
            scanNodes();
        } catch(e) { console.error(e); }
    }

    function scanNodes() {
        if (activeMode !== MODE.NATIVE_WEBAUDIO || !ctx) return;
        document.querySelectorAll('video, audio').forEach(attachNode);
    }

    function attachNode(el) {
        if (el._vm || el.dataset.vmAttached === "true") return;

        try {
            // Tweak crossOrigin for WebAudio
            if (!el.crossOrigin && !el.src.startsWith('data:') && !el.src.startsWith('blob:')) {
                el.crossOrigin = "anonymous";
            }

            const source = ctx.createMediaElementSource(el);
            const gain = ctx.createGain();
            const bass = ctx.createBiquadFilter(); bass.type = 'lowshelf'; bass.frequency.value = 200;
            const comp = ctx.createDynamicsCompressor();
            const analyser = ctx.createAnalyser(); analyser.fftSize = 256;
            const eqNodes = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map(f => {
                const n = ctx.createBiquadFilter(); n.type = 'peaking'; n.frequency.value = f; n.Q.value = 1.4; return n;
            });

            // Connect: Source -> Gain -> Bass -> EQ -> Comp -> Analyser -> Dest
            let head = source;
            head.connect(gain); head = gain;
            head.connect(bass); head = bass;
            eqNodes.forEach(n => { head.connect(n); head = n; });
            head.connect(comp); head = comp;
            head.connect(analyser); 
            analyser.connect(ctx.destination);

            el._vm = { source, gain, bass, comp, eqNodes, analyser };
            el.dataset.vmAttached = "true";
            
            const resume = () => { if(ctx && ctx.state === 'suspended') ctx.resume(); };
            el.addEventListener('play', resume);
            
        } catch(e) {
            // 静默处理 CORS 错误，这在多媒体页面是正常的（例如广告元素）
            // console.debug("[VM] WebAudio Attach Failed (likely CORS)", e);
        }
    }

    function updateWebAudioParams() {
        if (!ctx || activeMode !== MODE.NATIVE_WEBAUDIO) return;
        const t = ctx.currentTime; const r = 0.05;
        const v = config.muted ? 0 : (config.volume / 100); // 0.0 - 8.0

        document.querySelectorAll('video, audio').forEach(el => {
            if (!el._vm) return;
            const { gain, bass, comp, eqNodes } = el._vm;
            
            gain.gain.setTargetAtTime(v, t, r);
            gain.channelCount = config.mono ? 1 : 2;
            bass.gain.setTargetAtTime(config.bass ? 10 : 0, t, r);

            if (config.compressor) {
                comp.threshold.setTargetAtTime(-24, t, r);
                comp.ratio.setTargetAtTime(12, t, r);
            } else {
                comp.threshold.setTargetAtTime(-10, t, r);
                comp.ratio.setTargetAtTime(1, t, r);
            }
            eqNodes.forEach((n, i) => n.gain.setTargetAtTime(config.eqValues[i], t, r));
        });
    }

    // ============================================
    // 6. UI Helpers (OSD)
    // ============================================
    let osdContainer = null;
    let osdTimer = null;

    function showOSD() {
        if (config.enabled && !globalSettings.osdEnabled) return;
        if (!osdContainer) createOSD();
        
        const osd = osdContainer.getElementById('osd');
        const fill = osdContainer.getElementById('fill');
        const val = osdContainer.getElementById('val');
        const icon = osdContainer.getElementById('icon');
        
        osd.className = 'osd visible';
        
        // Color Logic
        const isCapture = (activeMode === MODE.CAPTURE);
        osd.classList.toggle('capture', isCapture);

        const isMuted = config.muted || config.volume === 0;
        osd.classList.toggle('muted', isMuted);

        fill.style.width = Math.min(100, (config.volume / 800) * 100) + '%';
        val.innerText = isMuted ? 'MUTE' : config.volume + '%';
        icon.innerText = isMuted ? '🔇' : (config.volume > 100 ? '🚀' : '🔊');

        clearTimeout(osdTimer);
        osdTimer = setTimeout(() => osd.classList.remove('visible'), 2000);
    }

    function createOSD() {
        const host = document.createElement('div');
        host.style.cssText = "position: fixed; top: 15%; left: 50%; transform: translateX(-50%); z-index: 2147483647; pointer-events: none;";
        document.body.appendChild(host);
        
        const shadow = host.attachShadow({mode: 'open'});
        shadow.innerHTML = `
            <style>
                .osd { background: rgba(20,20,30,0.85); backdrop-filter: blur(8px); padding: 12px 20px; border-radius: 30px; color: white; display: flex; align-items: center; gap: 12px; font-family: system-ui, sans-serif; transition: opacity 0.2s, transform 0.2s; opacity: 0; transform: translateY(-10px); }
                .osd.visible { opacity: 1; transform: translateY(0); }
                .bar-bg { width: 120px; height: 6px; background: rgba(255,255,255,0.2); border-radius: 3px; overflow: hidden; position: relative; }
                .bar-fill { height: 100%; width: 0%; transition: width 0.05s linear; border-radius: 3px; }
                .marker { position: absolute; left: 12.5%; top: 0; bottom: 0; width: 2px; background: rgba(255,255,255,0.6); z-index: 5; box-shadow: 0 0 2px rgba(0,0,0,0.5); }
                .text { font-weight: 600; font-size: 14px; min-width: 40px; text-align: right; }
                
                .bar-fill { background: #3b82f6; } /* Blue (Default) */
                .osd.capture .bar-fill { background: #8b5cf6; } /* Purple (Capture) */
                .osd.muted .bar-fill { background: #9ca3af !important; } /* Gray (Muted) */
                .osd.muted #icon { opacity: 0.6; }
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

    // ============================================
    // 7. Initialization & Events
    // ============================================
    function init() {
         // Efficient Observer
         let timeout;
         const observer = new MutationObserver(() => {
             clearTimeout(timeout);
             timeout = setTimeout(() => {
                if (activeMode === MODE.NATIVE_WEBAUDIO) scanNodes();
                // Re-apply state to ensure any new videos adhere to current policy
                applyState();
             }, 500);
         });
         observer.observe(document.body, { childList: true, subtree: true });
         
         // Aggressive Resume on ANY interaction or visibility change
         ['click', 'keydown', 'mousedown', 'touchstart', 'scroll', 'mousemove'].forEach(evt => 
             document.addEventListener(evt, () => { 
                 if(ctx && ctx.state === 'suspended') ctx.resume(); 
             }, {passive:true})
         );
         
         applyState();
    }

    // Load Settings
    chrome.storage.local.get(['siteSettings', 'globalSettings', 'userRegistry'], (res) => {
        if (res.siteSettings?.[location.hostname]) config = res.siteSettings[location.hostname];
        if (res.globalSettings) globalSettings = res.globalSettings;
        if (res.userRegistry) userRegistry = res.userRegistry;
        
        // Initial Sync
        chrome.runtime.sendMessage({ action: "getCaptureState" }, (isActive) => {
            isCaptureActive = isActive;
            init(); 
        });
    });

    // Message Handling
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.action === "updateConfig") {
            config = { ...config, ...msg.config };
            applyState();
            // Sync current state to popup if needed, or if capture active sync offscreen
            if (activeMode === MODE.CAPTURE) {
                chrome.runtime.sendMessage({ action: "updateCaptureConfig", config }).catch(()=>{});
            }
        }
        else if (msg.action === "globalSettingsUpdate") {
            globalSettings = { ...globalSettings, ...msg.settings };
            applyState(); 
        }
        else if (msg.action === "captureStateChange") {
            isCaptureActive = msg.enabled;
            isPendingCapture = false; // Reset lock
            applyState();
        }
        else if (msg.action === "shortcutTrigger") {
            if(!config.enabled) return;
            if (msg.command === "volume_up") config.volume = Math.min(config.volume + 10, 800);
            if (msg.command === "volume_down") config.volume = Math.max(config.volume - 10, 0);
            if (msg.command === "toggle_mute") config.muted = !config.muted;
            
            applyState(); // Mode switch might happen here
            showOSD();
            
            if (activeMode === MODE.CAPTURE) {
                 chrome.runtime.sendMessage({ action: "updateCaptureConfig", config }).catch(()=>{});
            }
            chrome.runtime.sendMessage({ action: "syncUI", config }).catch(()=>{});
        }
        else if (msg.action === "getStatus") {
            // 增强处理：如果首次调用时 activeMode 还未初始化，主动触发
            if (activeMode === null) {
                applyState(); // 立即初始化
            }
            // Attempt to wake up audio when Popup opens
            if (activeMode === MODE.NATIVE_WEBAUDIO) {
                ensureWebAudio();
                // 给一点时间让 AudioContext 初始化
                if (ctx && ctx.state === 'suspended') {
                    ctx.resume().catch(() => {});
                }
            }
            
            sendResponse({ 
                config, 
                hasAudio: document.querySelectorAll('video, audio').length > 0, 
                mode: activeMode 
            });
        }
        else if (msg.action === "getVisualizerData") {
             // 增强处理：如果 ctx 存在但处于 suspended，先尝试 resume
             if (activeMode === MODE.NATIVE_WEBAUDIO && ctx) {
                 if (ctx.state === 'suspended') {
                     ctx.resume().catch(() => {});
                 }
                 if (ctx.state === 'running' || ctx.state === 'suspended') {
                     // Return viz data from content script ONLY in Native WebAudio mode
                     const el = document.querySelector('video, audio');
                     if (el && el._vm && el._vm.analyser) {
                         const data = new Uint8Array(el._vm.analyser.frequencyBinCount);
                         el._vm.analyser.getByteFrequencyData(data);
                         sendResponse({ buffer: Array.from(data) });
                         return;
                     }
                 }
             }
             sendResponse({ buffer: null });
        }
    });

})();
