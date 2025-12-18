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
        'douyin.com', 'live.douyin.com', 'netflix.com', 'spotify.com'
    ];
    
    // 已检测到CORS限制并已通知用户的标记
    let corsDetectedAndNotified = false;

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
    let lastPlayTime = 0;      // 最近播放时间戳，用于 UI 保留
    let userHasInteracted = false; // 用户是否通过 UI/快捷键调节过音量（懒惰劫持策略）
    let isPopupOpen = false;   // Popup 是否打开且连接中
    
    // ============================================
    // 角标更新通知
    // ============================================
    /**
     * 通知 background.js 更新插件图标角标
     * 全局性地，不分模式、网站、音量，只要用户操作过就显示
     * 角标颜色与当前策略一致（原生=蓝色，劫持=紫色）
     */
    function notifyBadgeUpdate() {
        chrome.runtime.sendMessage({ 
            action: "updateBadge", 
            volume: config.volume, 
            muted: config.muted,
            isCapture: activeMode === MODE.CAPTURE
        }).catch(() => {});
    }

    // ============================================
    // 3. Logic Engine (The Brain)
    // ============================================
    function isRestrictedSite() {
        const host = window.location.hostname;
        return RESTRICTED_DOMAINS.some(d => host.includes(d)) || userRegistry.includes(host);
    }

    /**
     * 检测当前是否在视频播放页（而非推荐页预览）
     * 通过 URL 路径、参数、hash 等多种方式综合判断
     * 
     * 核心逻辑：
     * 1. 检查 URL 路径是否包含视频相关关键词
     * 2. 检查 URL 参数是否包含视频标识（如 modal_id, v, video_id 等）
     * 3. 检查 hash 是否包含视频标识
     * 4. 对于特定网站使用特定规则
     */
    function isVideoPlayPage() {
        const path = window.location.pathname;
        const host = window.location.hostname;
        const search = window.location.search;
        const hash = window.location.hash;
        const href = window.location.href;
        
        // ========== 通用参数检测 ==========
        // 这些参数通常表示正在播放特定视频
        const videoParams = ['modal_id', 'video_id', 'vid', 'v', 'bvid', 'aid', 'ep_id'];
        const urlParams = new URLSearchParams(search);
        const hasVideoParam = videoParams.some(p => urlParams.has(p));
        
        // 检查 hash 中是否有视频标识（如 #/video/xxx 或 #modal_id=xxx）
        const hashHasVideo = /video|modal|play|watch/i.test(hash);
        
        // 如果有视频参数或 hash 中有视频标识，认为是播放页
        if (hasVideoParam || hashHasVideo) {
            return true;
        }
        
        // ========== 网站特定规则 ==========
        
        // 抖音 (douyin.com)
        // - live.douyin.com/xxx → 直播子域名，整个都是播放页
        // - /video/xxx → 直接视频页
        // - /live/xxx → 直播页
        // - 任何路径 + modal_id 参数 → 模态视频（已在上面处理）
        if (host.includes('douyin.com')) {
            // live.douyin.com 子域名下的所有页面都是直播播放页
            if (host.startsWith('live.')) {
                return true;
            }
            return path.includes('/video/') || path.includes('/live/');
        }
        
        // YouTube (youtube.com)
        // - /watch?v=xxx → 视频页
        // - /embed/xxx → 嵌入播放
        // - /shorts/xxx → 短视频
        if (host.includes('youtube.com')) {
            return path.includes('/watch') || path.includes('/embed/') || path.includes('/shorts/');
        }
        
        // Bilibili (bilibili.com)
        // - /video/BVxxx → 视频页
        // - /bangumi/play/xxx → 番剧播放
        // - /cheese/play/xxx → 课程播放
        if (host.includes('bilibili.com')) {
            return path.includes('/video/') || path.includes('/bangumi/') || path.includes('/cheese/');
        }
        
        // Netflix (netflix.com)
        // - /watch/xxx → 视频播放
        if (host.includes('netflix.com')) {
            return path.includes('/watch/');
        }
        
        // TikTok (tiktok.com)
        // - /@user/video/xxx → 视频页
        // - /video/xxx → 视频页
        if (host.includes('tiktok.com')) {
            return path.includes('/video/') || /\/@[\w.-]+\/video\//.test(path);
        }
        
        // Spotify (spotify.com)
        // - /track/xxx, /episode/xxx → 播放页
        if (host.includes('spotify.com')) {
            return path.includes('/track/') || path.includes('/episode/');
        }
        
        // ========== 通用路径模式匹配 ==========
        const genericPathPatterns = [
            /\/video\//i,      // /video/xxx
            /\/watch/i,        // /watch, /watch?v=xxx
            /\/play\//i,       // /play/xxx
            /\/v\//i,          // /v/xxx (短链)
            /\/live\//i,       // /live/xxx
            /\/embed\//i,      // /embed/xxx
            /\/player\//i,     // /player/xxx
            /\/episode\//i,    // /episode/xxx
            /\/track\//i,      // /track/xxx
            /\/clip\//i,       // /clip/xxx
        ];
        
        // 首页/推荐页通常是根路径或特定路径
        // 注意：这个检查要在通用模式匹配之前，避免误判
        if (path === '/' || path === '') {
            return false;
        }
        
        return genericPathPatterns.some(pattern => pattern.test(path));
    }

    /**
     * Calculates the DESIRED mode based on current config.
     * This is the single source of truth for strategy.
     * 
     * 完整策略逻辑：
     * 
     * 【推荐页预览场景】（isVideoPlayPage = false）
     * - 用户未交互：原生模式（非受限=NATIVE_WEBAUDIO，受限=NATIVE_LITE）
     * - 用户已交互：全音量劫持模式（受限网站=CAPTURE，非受限=NATIVE_WEBAUDIO）
     * 
     * 【播放页场景】（isVideoPlayPage = true，无论用户是否交互）
     * - 跨域不限制网站：全音量原生模式（NATIVE_WEBAUDIO）
     * - 跨域限制网站：
     *   - 频谱开：全音量劫持模式（CAPTURE）
     *   - 频谱关：音量 > 100 → CAPTURE；音量 ≤ 100 → NATIVE_LITE
     */
    function calculateDesiredMode() {
        if (!config.enabled) return MODE.NATIVE_LITE; // Disabled -> Safe Lite Mode

        const restricted = isRestrictedSite();
        const isPlayPage = isVideoPlayPage();
        const vizOn = globalSettings.visualizerEnabled !== false;
        const vol = config.volume;

        if (isPlayPage) {
            // ========== 播放页逻辑（无论用户是否交互）==========
            if (!restricted) {
                // 非受限网站：全音量原生模式
                return MODE.NATIVE_WEBAUDIO;
            } else {
                // 受限网站
                if (vizOn) {
                    // 频谱开：全音量劫持模式
                    return MODE.CAPTURE;
                } else {
                    // 频谱关：根据音量决定
                    if (vol > 100) return MODE.CAPTURE;  // 音量 > 100 → 劫持
                    return MODE.NATIVE_LITE;              // 音量 ≤ 100 → 原生
                }
            }
        } else {
            // ========== 推荐页预览逻辑 ==========
            if (!userHasInteracted) {
                // 用户未交互：默认原生模式（节省资源）
                return restricted ? MODE.NATIVE_LITE : MODE.NATIVE_WEBAUDIO;
            } else {
                // 用户已交互：需要完整音量控制
                // 非受限网站用 NATIVE_WEBAUDIO（已支持 0-800%）
                // 受限网站必须用 CAPTURE（劫持模式）
                return restricted ? MODE.CAPTURE : MODE.NATIVE_WEBAUDIO;
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
             if (ctx.state === 'suspended') ctx.resume().catch(() => {});
             return;
        }
        
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            ctx = new AC();
            // 如果创建时就是 suspended 状态，尝试恢复（但可能会因为无用户交互而失败）
            if (ctx.state === 'suspended') ctx.resume().catch(() => {});
            scanNodes();
        } catch(e) {
            // 静默处理 AudioContext 创建失败（通常是自动播放策略限制）
        }
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
            
            const resume = () => { if(ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); };
            el.addEventListener('play', resume);
            
        } catch(e) {
            // 检测到 CORS 限制或其他 WebAudio 附加失败
            // 常见错误类型: NotSupportedError, InvalidStateError
            handleCorsDetected();
        }
    }
    
    // 处理 CORS 检测：智能添加到劫持列表
    function handleCorsDetected() {
        if (corsDetectedAndNotified) return; // 只通知一次
        
        const host = window.location.hostname;
        // 检查是否已在列表中
        if (isRestrictedSite()) return;
        
        // 检查是否有媒体元素（不一定要播放中，有媒体就说明是视频站点）
        const mediaElements = document.querySelectorAll('video, audio');
        if (mediaElements.length === 0) return;
        
        corsDetectedAndNotified = true;
        
        // 自动添加到用户劫持列表
        chrome.runtime.sendMessage({ 
            action: "addToRegistry", 
            domain: host 
        }, (response) => {
            // 必须检查 lastError 来防止错误
            void chrome.runtime.lastError;
            
            if (response && response.success) {
                // 更新本地列表
                userRegistry.push(host);
                // 显示 Toast 通知
                showToast(globalSettings.lang === 'zh-CN' 
                    ? `🔧 已自动添加 ${host} 到劫持列表` 
                    : `🔧 Auto-added ${host} to capture list`);
                // 重新应用状态以切换到 Capture 模式
                applyState();
            }
        });
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
    
    // Toast 通知（用于自动添加劫持列表等场景）
    let toastContainer = null;
    let toastTimer = null;
    
    function showToast(message) {
        // 确保 document.body 已存在
        if (!document.body) {
            console.warn('[VM] Cannot show toast: document.body not ready');
            return;
        }
        
        if (!toastContainer) createToast();
        if (!toastContainer) return; // 创建失败
        
        const toast = toastContainer.getElementById('toast');
        const text = toastContainer.getElementById('toast-text');
        
        if (!toast || !text) return;
        
        text.innerText = message;
        toast.classList.add('visible');
        
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('visible'), 3000);
    }
    
    function createToast() {
        if (!document.body) return;
        
        const host = document.createElement('div');
        host.id = 'vm-toast-host';
        host.style.cssText = "position: fixed; top: 20%; left: 50%; transform: translateX(-50%); z-index: 2147483647; pointer-events: none;";
        document.body.appendChild(host);
        
        const shadow = host.attachShadow({mode: 'open'});
        shadow.innerHTML = `
            <style>
                .toast { background: rgba(20,20,30,0.92); backdrop-filter: blur(10px); padding: 14px 24px; border-radius: 14px; color: white; font-family: system-ui, -apple-system, sans-serif; transition: opacity 0.3s ease, transform 0.3s ease; opacity: 0; transform: translateY(-15px); display: flex; align-items: center; gap: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); }
                .toast.visible { opacity: 1; transform: translateY(0); }
                .toast-text { font-size: 14px; font-weight: 500; white-space: nowrap; }
            </style>
            <div class="toast" id="toast">
                <span class="toast-text" id="toast-text"></span>
            </div>
        `;
        toastContainer = shadow;
    }

    // ============================================
    // 7. Initialization & Events
    // ============================================
    function init() {
         // Efficient Observer for DOM changes
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
         
         // 定期重新应用状态（处理动态加载的预览视频、iframe等）
         setInterval(() => {
             if (activeMode === MODE.NATIVE_LITE || activeMode === MODE.NATIVE_WEBAUDIO) {
                 applyState();
             }
         }, 2000);
         
         // Aggressive Resume on ANY interaction or visibility change
         ['click', 'keydown', 'mousedown', 'touchstart', 'scroll', 'mousemove'].forEach(evt => 
             document.addEventListener(evt, () => { 
                 if(ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); 
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
            
    // 监听来自 Popup 的专用连接，用于跟踪 Popup 开启状态
    chrome.runtime.onConnect.addListener((port) => {
        if (port.name === "popup-connection") {
            isPopupOpen = true;
            port.onDisconnect.addListener(() => {
                isPopupOpen = false;
            });
        }
    });

    // Message Handling
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.action === "updateConfig") {
            // 用户通过 UI 调节了配置，标记为已交互
            userHasInteracted = true;
            config = { ...config, ...msg.config };
            applyState();
            // 更新角标
            notifyBadgeUpdate();
            // Sync current state to popup if needed, or if capture active sync offscreen
            if (activeMode === MODE.CAPTURE) {
                chrome.runtime.sendMessage({ action: "updateCaptureConfig", config }).catch(()=>{});
            }
        }
        else if (msg.action === "popupConnected") {
            isPopupOpen = true; // 需在 popup 端发送此消息，或者使用 onConnect
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
            // 用户通过快捷键调节，标记为已交互
            userHasInteracted = true;
            if (msg.command === "volume_up") config.volume = Math.min(config.volume + 10, 800);
            if (msg.command === "volume_down") config.volume = Math.max(config.volume - 10, 0);
            if (msg.command === "toggle_mute") config.muted = !config.muted;
            
            applyState(); // Mode switch might happen here
            
            // 更新角标
            notifyBadgeUpdate();
            
            // 只有当 Popup 未打开时才显示 OSD
            if (!isPopupOpen) {
                showOSD();
            }
            
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
            
            // 检查是否有媒体元素（包括预览窗口的视频）
            const mediaElements = document.querySelectorAll('video, audio');
            
            // 检查是否有正在播放的媒体
            const hasPlayingMedia = Array.from(mediaElements).some(el => 
                !el.paused && !el.ended && el.readyState > 2 && el.currentTime > 0
            );
            
            // 如果有播放中的媒体，更新最近播放时间
            if (hasPlayingMedia) {
                lastPlayTime = Date.now();
            }
            
            // “最近播放”逻辑：60秒内有播放过的媒体也视为活跃（用户要求从30s改为1min）
            const recentlyPlayed = (Date.now() - lastPlayTime) < 60000;
            
            sendResponse({ 
                config, 
                hasAudio: mediaElements.length > 0,
                isPlaying: hasPlayingMedia || isCaptureActive || recentlyPlayed,
                mode: activeMode,
                userInteracted: userHasInteracted // 告诉 popup 用户是否已交互
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
