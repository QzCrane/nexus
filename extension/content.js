(function() {
    if (window.VMInjected) return;
    window.VMInjected = true;

    // ============================================
    // 1. 策略注册表 & 状态管理
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
    let SITE_REGISTRY = { ...DEFAULT_REGISTRY };

    // 【关键修复】只保留 Context 为全局，其他节点必须跟随元素
    let ctx; 
    let activeAnalyser = null; // 追踪当前活跃的分析器用于可视化

    let config = { enabled: true, volume: 100, muted: false, compressor: false, mono: false, bass: false, eqValues: [0,0,0,0,0,0,0,0,0,0] };
    let globalSettings = { osdEnabled: true, lang: 'en-US' };
    let currentStrategy = STRATEGY.NATIVE;
    let isPopupOpen = false;
    let osdContainer = null;
    let osdTimer = null;
    let isCaptureActive = false;

    chrome.storage.local.get(['userRegistry', 'siteSettings', 'globalSettings'], (res) => {
        if (res.userRegistry) res.userRegistry.forEach(d => SITE_REGISTRY[d] = STRATEGY.CAPTURE);
        if (res.siteSettings?.[location.hostname]) config = res.siteSettings[location.hostname];
        if (res.globalSettings) globalSettings = res.globalSettings;
        init();
    });

    // ============================================
    // 2. 策略引擎
    // ============================================
    function determineStrategy(hostname) {
        for (const [domain, strategy] of Object.entries(SITE_REGISTRY)) {
            if (hostname.includes(domain)) return strategy;
        }
        return localStorage.getItem('VM_STRATEGY_CACHE') === STRATEGY.CAPTURE ? STRATEGY.CAPTURE : STRATEGY.NATIVE;
    }

    function fastCorsCheck(el) {
        if (currentStrategy === STRATEGY.CAPTURE) return false;
        const src = el.currentSrc || el.src;
        if (src && src.startsWith('http')) {
            try {
                const srcUrl = new URL(src);
                if (srcUrl.hostname !== window.location.hostname && (!el.crossOrigin || el.crossOrigin.toLowerCase() !== 'anonymous')) {
                    console.warn("VM: CORS risk -> Switching to CAPTURE.");
                    switchStrategy(STRATEGY.CAPTURE);
                    const domain = window.location.hostname;
                    chrome.storage.local.get(['userRegistry'], (r) => {
                        const list = r.userRegistry || [];
                        if (!list.includes(domain)) chrome.storage.local.set({ userRegistry: [...list, domain] });
                    });
                    showToast(globalSettings.lang === 'zh-CN' ? "检测到受保护内容，已启用增强模式。" : "Protected content detected. Enhanced Mode activated.");
                    return false;
                }
            } catch(e) {}
        }
        return true;
    }

    function switchStrategy(newStrategy) {
        if (currentStrategy === newStrategy) return;
        currentStrategy = newStrategy;
        if (newStrategy === STRATEGY.CAPTURE) {
            localStorage.setItem('VM_STRATEGY_CACHE', STRATEGY.CAPTURE);
            activateCaptureMode();
        }
    }

    function showToast(text) {
        const div = document.createElement('div');
        div.style.cssText = "position: fixed; top: 20px; left: 50%; transform: translateX(-50%) translateY(-20px); background: rgba(0,0,0,0.8); color: #fff; padding: 8px 16px; border-radius: 8px; font-size: 12px; font-family: sans-serif; z-index: 2147483647; opacity: 0; transition: 0.3s; pointer-events: none;";
        div.innerText = text;
        document.body.appendChild(div);
        requestAnimationFrame(() => { div.style.transform = "translateX(-50%) translateY(0)"; div.style.opacity = "1"; });
        setTimeout(() => { div.style.opacity = "0"; div.style.transform = "translateX(-50%) translateY(-20px)"; setTimeout(() => div.remove(), 300); }, 3000);
    }

    // ============================================
    // 3. 初始化 & Audio 绑定 (核心修复区)
    // ============================================
    function init() {
        currentStrategy = determineStrategy(window.location.hostname);
        let debounceTimer = null;
        const observer = new MutationObserver((mutations) => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                let found = false;
                mutations.forEach(m => { m.addedNodes.forEach(n => { if (n.nodeName === 'VIDEO' || n.nodeName === 'AUDIO') found = true; }); });
                if(found) scan();
            }, 1000);
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
        scan();
    }

    function scan() { document.querySelectorAll('video, audio').forEach(initAudio); }

    function initAudio(el) {
        if (el.dataset.vmAttached) return;
        el.dataset.vmAttached = "true";

        if (currentStrategy === STRATEGY.CAPTURE) { activateCaptureMode(); return; }
        if (!fastCorsCheck(el)) return;

        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            
            // 确保 Context 单例，避免内存泄漏
            if (!ctx) ctx = new AC();

            // 如果 Context 处于挂起，尝试恢复
            if (ctx.state === 'suspended') ctx.resume();

            // 【CORS 处理】首先检查是否安全
            if (currentStrategy === STRATEGY.NATIVE && !fastCorsCheck(el)) return;

            // 【重复绑定检查】防止重复创建 Source 导致报错
            if (el._vm) {       
                 // 已绑定过，直接使用 (可能由 initAudio 多次调用触发)
                 // 但需要确认 Context 是否因为页面休眠挂了？一般不会
                 applyStateToElement(el);
                 return;
            }

            // 【关键修复】创建 MediaElementSource 可能会因为 CORS 隐式失败
            // 即使 fastCorsCheck 通过，浏览器依然可能抛出 "MediaElementAudioSource outputs zeroes due to CORS access restrictions"
            // 这种情况下不会报错，但会静音。我们需要一种方式来检测？
            // 目前还没有可靠的 JS API 检测静音，只能依赖之前的 fastCorsCheck 严格检查。
            
            let source;
            try { 
                source = ctx.createMediaElementSource(el); 
            } catch (e) { 
                // 如果这里报错，说明被浏览器拦截了（比如已经连接到其他 Context，或者 CORS 彻底失败）
                console.warn("VM: MediaElementSource creation failed", e);
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

            // 连接链路: Source -> Bass -> EQ... -> Destination
            let head = source;
            head.connect(bass); head = bass;
            eqNodes.forEach(n => { head.connect(n); head = n; });
            head.connect(comp); head = comp;
            head.connect(gain); head = gain; 
            head.connect(analyser); 
            
            // 【关键】一定要连接到 ctx.destination 否则没声音
            analyser.connect(ctx.destination);

            // 挂载到 DOM
            el._vm = { gain, bass, comp, eqNodes, analyser, source };

            // 激活事件：播放时确保 Context 运行
            const resume = () => { 
                if(ctx.state === 'suspended') ctx.resume(); 
                activeAnalyser = analyser; 
                applyStateToElement(el); 
            };
            el.addEventListener('play', resume);
            el.addEventListener('canplay', resume);
            
            // 【关键音量锁定】Native 模式下，必须接管音量控制权
            // 如果用户调节播放器音量条，我们必须强制将其重置为 1.0 (最大)，
            // 否则 Source 信号会被衰减。
            // 修正：添加 flag 防止死循环，虽然 volumechange 一般比较安全
            let isLocking = false;
            const lockVolume = (e) => {
                if (currentStrategy === STRATEGY.NATIVE && !isCaptureActive) {
                    // 如果实际音量不为 1 (允许微小误差) 且没开启静音
                    if ((Math.abs(el.volume - 1) > 0.01 || el.muted) && !config.muted) {
                         if (isLocking) return;
                         isLocking = true;
                         el.volume = 1;
                         el.muted = false;
                         setTimeout(() => isLocking = false, 0);
                    }
                }
            };
            el.addEventListener('volumechange', lockVolume);
            
            // 立即应用一次
            applyStateToElement(el);

            // 初始锁定：强制 Unmute + Max Volume
            if (currentStrategy === STRATEGY.NATIVE) { 
                el.muted = false; 
                el.volume = 1; 
            }

        } catch (e) { 
            console.error("VM: Audio init error", e);
            switchStrategy(STRATEGY.CAPTURE); 
        }
    }

    function activateCaptureMode() {
        if (isCaptureActive) return;
        chrome.runtime.sendMessage({ action: "toggleCapture", enabled: true, config: config, forceStrategy: true });
    }

    // 全局应用状态：遍历所有视频
    function applyState() {
        if (isCaptureActive || currentStrategy === STRATEGY.CAPTURE) {
            // Capture 模式下：
            // 1. Content Script 停止 DSP 处理 (交由 Offscreen)
            // 2. 依然需要确保 Video 正常播放 (不静音，满音量) 
            document.querySelectorAll('video, audio').forEach(el => {
                if (el.muted && !config.muted) el.muted = false;
                if (el.volume !== 1) el.volume = 1; 
            });
            return;
        }
        document.querySelectorAll('video, audio').forEach(applyStateToElement);
    }

    // 【关键修复】针对单个元素的节点应用配置
    function applyStateToElement(el) {
        if (!el._vm || !ctx) return;
        const { gain, bass, comp, eqNodes } = el._vm;
        
        // 确保 Context 处于 Running 状态
        if (ctx.state === 'suspended') ctx.resume();

        const t = ctx.currentTime; const r = 0.1; // 统一平滑时间为 0.1s
        
        // 音量映射：
        // Config Volume: 0 - 800 (代表百分比)
        // Gain Node: 0.0 - 8.0
        const v = config.muted ? 0 : (config.volume / 100);
        
        gain.gain.setTargetAtTime(v, t, r);
        gain.channelCount = config.mono ? 1 : 2;
        bass.gain.setTargetAtTime(config.bass ? 10 : 0, t, r);
        
        if (config.compressor) {
            // 启用的压缩器设置 (防爆音)
            comp.threshold.setTargetAtTime(-24, t, r); // -24dB 开始压缩
            comp.knee.setTargetAtTime(30, t, r);       // 软拐点
            comp.ratio.setTargetAtTime(12, t, r);      // 强压缩比
            comp.attack.setTargetAtTime(0.003, t, r);  // 快启动
            comp.release.setTargetAtTime(0.25, t, r);  // 适中释放
        } else {
            // 关闭时的直通设置
            comp.threshold.setTargetAtTime(0, t, r);
            comp.ratio.setTargetAtTime(1, t, r);
        }
        eqNodes.forEach((n, i) => n.gain.setTargetAtTime(config.eqValues[i], t, r));
    }

    // ============================================
    // 4. 全屏劫持
    // ============================================
    const nativeRequestFullscreen = Element.prototype.requestFullscreen;
    const nativeExitFullscreen = Document.prototype.exitFullscreen;
    Element.prototype.requestFullscreen = function(options) {
        if (isCaptureActive) {
            const container = this.closest('.xgplayer-container, .bilibili-player-area, .html5-video-player') || this;
            enterFakeFullscreen(container);
            return Promise.resolve();
        }
        return nativeRequestFullscreen.apply(this, arguments);
    };
    Document.prototype.exitFullscreen = function() {
        if (document.body.classList.contains('vm-fake-fs')) { exitFakeFullscreen(); return Promise.resolve(); }
        return nativeExitFullscreen.apply(this, arguments);
    };
    function enterFakeFullscreen(el) { el.classList.add('vm-fs-target'); document.body.classList.add('vm-fake-fs'); el.dispatchEvent(new Event('fullscreenchange', { bubbles: true })); }
    function exitFakeFullscreen() { document.querySelectorAll('.vm-fs-target').forEach(el => el.classList.remove('vm-fs-target')); document.body.classList.remove('vm-fake-fs'); document.dispatchEvent(new Event('fullscreenchange', { bubbles: true })); }
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('vm-fake-fs')) exitFakeFullscreen(); }, true);
    const fsStyle = document.createElement('style');
    fsStyle.innerHTML = `body.vm-fake-fs { overflow: hidden !important; } .vm-fs-target { position: fixed !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100vh !important; z-index: 2147483647 !important; background: #000 !important; }`;
    (document.head || document.documentElement).appendChild(fsStyle);

    // ============================================
    // 5. OSD 屏幕提示
    // ============================================
    function showOSD() {
        if (isPopupOpen || !config.enabled || !globalSettings.osdEnabled) return;
        if (!osdContainer) {
            const host = document.createElement('div');
            host.style.cssText = "position: fixed; top: 15%; left: 50%; transform: translateX(-50%); z-index: 2147483647; pointer-events: none;";
            document.body.appendChild(host);
            const shadow = host.attachShadow({mode: 'open'});
            shadow.innerHTML = `
                <style>
                    .osd-card { background: rgba(255, 255, 255, 0.95); backdrop-filter: blur(12px); padding: 12px 16px; border-radius: 50px; box-shadow: 0 8px 32px rgba(0,0,0,0.15); display: flex; flex-direction: row; align-items: center; gap: 14px; font-family: system-ui, sans-serif; opacity: 0; transform: translateY(-8px); transition: opacity 0.2s, transform 0.2s; border: 1px solid rgba(255,255,255,0.8); width: 260px; box-sizing: border-box; }
                    .osd-card.visible { opacity: 1; transform: translateY(0); }
                    .icon { font-size: 20px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 24px; }
                    .bar-rail { flex: 1; height: 6px; background: #e2e8f0; border-radius: 3px; overflow: hidden; position: relative; min-width: 0; }
                    .bar-fill { height: 100%; background: #2563eb; width: 0%; transition: width 0.08s linear; border-radius: 3px; }
                    .marker-100 { position: absolute; left: 12.5%; top: 0; bottom: 0; width: 2px; background: #fff; z-index: 2; }
                    .val-text { font-size: 15px; font-weight: 800; color: #2563eb; font-variant-numeric: tabular-nums; white-space: nowrap; flex-shrink: 0; text-align: right; min-width: 45px; }
                    .osd-card.vm-capture .bar-fill { background: #7c3aed; }
                    .osd-card.vm-capture .val-text { color: #7c3aed; }
                    .osd-card.muted .bar-fill { background: #94a3b8; }
                    .osd-card.muted .val-text { color: #94a3b8; }
                </style>
                <div class="osd-card" id="card"><div class="icon" id="icon">🔊</div><div class="bar-rail"><div class="marker-100"></div><div class="bar-fill" id="fill"></div></div><div class="val-text" id="val">100%</div></div>
            `;
            osdContainer = shadow;
        }
        const card = osdContainer.getElementById('card');
        const fill = osdContainer.getElementById('fill');
        const val = osdContainer.getElementById('val');
        const icon = osdContainer.getElementById('icon');
        
        card.classList.toggle('vm-capture', isCaptureActive);
        card.classList.toggle('muted', config.muted);
        const pct = Math.min(config.volume / 800 * 100, 100);
        fill.style.width = pct + '%';
        val.innerText = config.muted ? 'MUTE' : config.volume + '%';
        icon.innerText = config.muted ? '🔇' : (config.volume > 100 ? '🚀' : '🔊');
        
        card.classList.remove('visible'); void card.offsetWidth; card.classList.add('visible');
        clearTimeout(osdTimer); osdTimer = setTimeout(() => card.classList.remove('visible'), 1500);
    }

    try {
        // 监听长连接 (来自 Popup)
        chrome.runtime.onConnect.addListener((port) => {
            if (port.name === "popup-connection") {
                isPopupOpen = true;
                
                // 立即同步一次当前状态，防止 UI 显示旧数据
                // 这是一个主动推送，确保 UI 打开瞬间就是最新的
                try {
                    port.postMessage({ action: "syncUI", config: config }); 
                } catch(e) {}

                port.onDisconnect.addListener(() => { 
                    isPopupOpen = false; 
                });
            }
        });
    } catch(e) {}

    // ============================================
    // 6. 消息处理
    // ============================================
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.action === "getStatus") {
            const els = document.querySelectorAll('video, audio');
            // 准确返回当前的模式状态
            // isCaptureActive 是指音频捕获是否正在运行 (录制中)
            // currentStrategy 是指页面当前的策略 (NATIVE 或 CAPTURE)
            // 只要是 Capture 策略，UI 就应显示紫色，哪怕还没开始播放
            let mode = 'NATIVE';
            if (isCaptureActive || currentStrategy === STRATEGY.CAPTURE) mode = 'CAPTURE';
            
            sendResponse({ 
                config: config, 
                hasAudio: els.length > 0, 
                mode: mode
            });
        }
        else if (msg.action === "updateConfig") {
            config = { ...config, ...msg.config };
            
            // 激进策略：立即应用
            applyState();
            
            // 【双保险机制】借鉴 extension3
            // 同时更新 DOM 音量，防止 WebAudio 延迟或失效导致用户觉得“没反应”
            // 只有在 Native 模式且音量 <= 100% 时，直接操作 DOM volume 是最快最稳的
            if (!isCaptureActive && currentStrategy === STRATEGY.NATIVE) {
                document.querySelectorAll('video, audio').forEach(el => {
                    // 如果音量 > 100，则保持 DOM 为 1.0 (最大)，由 GainNode 放大
                    // 如果音量 <= 100，则同步 DOM volume，获得原生丝滑体验
                    if (config.volume <= 100) {
                        el.volume = config.muted ? 0 : (config.volume / 100);
                        el.muted = config.muted;
                    } else {
                        if(el.volume !== 1) el.volume = 1;
                        if(el.muted) el.muted = false;
                    }
                });
            } else if (isCaptureActive) {
                // 如果是 Capture 模式，确保源不被静音 (Capture 会负责静音 Tab 输出，但源 Element 必须有声)
                document.querySelectorAll('video, audio').forEach(el => {
                     // 某些网站在被 Capture 时会自动暂停或静音，这里强制保持活跃
                     if(el.muted && !config.muted) el.muted = false;
                     // Capture 模式下源音量最好最大，以此获得最佳信噪比
                     if(el.volume !== 1) el.volume = 1;
                });
            }
        }
        else if (msg.action === "captureStateChange") {
            isCaptureActive = msg.enabled;
            applyState();
        }
        else if (msg.action === "getVisualizerData") {
            if (isCaptureActive) { sendResponse({ buffer: null }); return; }
            // 【关键修复】使用当前活跃的 analyser
            const target = activeAnalyser || (document.querySelector('video')?._vm?.analyser); 
            if (!target) return sendResponse({ buffer: null });
            const data = new Uint8Array(target.frequencyBinCount);
            target.getByteFrequencyData(data);
            sendResponse({ buffer: Array.from(data) });
        }
        else if (msg.action === "shortcutTrigger") {
             if(!config.enabled) return;
             if (msg.command === "volume_up") config.volume = Math.min(config.volume + 10, 800);
             if (msg.command === "volume_down") config.volume = Math.max(config.volume - 10, 0);
             if (msg.command === "toggle_mute") config.muted = !config.muted;
             
             if (isCaptureActive) chrome.runtime.sendMessage({ action: "updateCaptureConfig", config });
             else applyState();
             
             showOSD();
             try { chrome.runtime.sendMessage({ action: "syncUI", config }); } catch(e) {}
        }
        else if (msg.action === "globalSettingsUpdate") {
            globalSettings = { ...globalSettings, ...msg.settings };
        }
    });
})();