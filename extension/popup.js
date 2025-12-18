/**
 * Media Master 2026 - Popup Logic
 */

const I18N = {
    'en-US': { settingsTitle: "Settings", osdLabel: "OSD Popup", osdSub: "Overlay when using shortcuts", vizLabel: "Visualizer", vizSub: "Show dynamic audio bars", vizDesc: "Disabling this saves resources on restricted sites (e.g. Tiktok) by using Native Lite mode until volume > 100%.", langLabel: "Language", noAudio: "No Audio Signal", bgTitle: "Background", paused: "Paused", comp: "Compressor", bass: "Bass", mono: "Mono", eqTitle: "🎚️ 10-Band EQ", reset: "Reset", save: "Save", resetTooltip: "Reset volume and EQ to default values", saveTooltip: "Save current settings as default for this domain", paused: "Audio Enhancement Paused", clickToResume: "Click to Resume", captureListLabel: "Force Capture Mode", captureListSub: "One domain per line (e.g. tiktok.com)", grpInterface: "Interface", grpGeneral: "General", grpAdvanced: "Advanced" },
    'zh-CN': { settingsTitle: "设置", osdLabel: "屏幕提示 (OSD)", osdSub: "快捷键调节时显示", vizLabel: "动态频谱", vizSub: "显示可视化音频条", vizDesc: "关闭后，受限网站 (如抖音) 将预设使用极其省电的原生模式，仅在音量超过100%时自动切换增强模式。", langLabel: "语言 (Language)", noAudio: "无音频信号", bgTitle: "后台播放", paused: "已暂停", comp: "防爆音", bass: "低音", mono: "单声道", eqTitle: "🎚️ 10段均衡器", reset: "重置", save: "保存", resetTooltip: "将当前标签页的音量和均衡器恢复为默认值", saveTooltip: "将当前配置保存为该网站 (域名) 的永久默认配置", paused: "增强已暂停", clickToResume: "点击恢复", captureListLabel: "强制劫持列表", captureListSub: "每行一个域名 (如 douyin.com)", grpInterface: "界面", grpGeneral: "通用", grpAdvanced: "高级" }
};

const DEFAULT_DEFAULTS = ['douyin.com', 'live.douyin.com', 'netflix.com', 'spotify.com'];

const getDomain = (url) => { try { return new URL(url).hostname; } catch { return 'local'; } };
async function sendToTab(tabId, msg) { try { return await chrome.tabs.sendMessage(tabId, msg); } catch { return null; } }
async function ensureInjected(tabId) { try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }); return true; } catch { return false; } }

const DEFAULT = { enabled: true, volume: 100, muted: false, compressor: false, mono: false, bass: false, eqValues: [0,0,0,0,0,0,0,0,0,0] };
function clean(c) {
    const s = { ...DEFAULT, ...c };
    if (!Array.isArray(s.eqValues)) s.eqValues = DEFAULT.eqValues;
    if (s.enabled === undefined) s.enabled = true;
    return s;
}

// 模块级变量，让 initCard 函数能够访问
let gSettings = { osdEnabled: true, visualizerEnabled: true, lang: 'en-US' };
const cardRenderCallbacks = [];

class MetricsCache {
    constructor(rowElement, canvas, onChange) {
        this.row = rowElement; this.canvas = canvas; this.onChange = onChange; 
        this.xCoords = new Float32Array(10); this.midY = 0; this.width = 0; this.height = 0; this.dpr = 1; this.scaleFactor = 3.66; this.isValid = false;
        this.observer = new ResizeObserver(() => this.update()); this.observer.observe(rowElement);
        this.update(); const initLoop = (c) => { if (this.update() || c <= 0) return; requestAnimationFrame(() => initLoop(c - 1)); }; initLoop(20);
    }
    update() {
        if (!this.row) return false;
        const rect = this.row.getBoundingClientRect(); if (rect.width === 0) return false;
        const canvasRect = this.canvas.getBoundingClientRect();
        this.dpr = window.devicePixelRatio || 1;
        const physW = canvasRect.width * this.dpr; const physH = canvasRect.height * this.dpr;
        if (this.canvas.width !== physW || this.canvas.height !== physH) { this.canvas.width = physW; this.canvas.height = physH; }
        this.width = canvasRect.width; this.height = canvasRect.height; this.midY = (rect.top - canvasRect.top) + (rect.height / 2);
        const inputs = this.row.querySelectorAll('input');
        if (inputs.length > 0) { const inputRect = inputs[0].getBoundingClientRect(); this.scaleFactor = (inputRect.height - 12) / 24; }
        inputs.forEach((input, i) => { const r = input.getBoundingClientRect(); this.xCoords[i] = (r.left - canvasRect.left) + (r.width / 2); });
        this.isValid = true; if (this.onChange) this.onChange(); return true;
    }
}

function drawViz(canvas, data, isMuted, isCapture) {
    const ctx = canvas.getContext('2d'); const w = canvas.width, h = canvas.height; ctx.clearRect(0,0,w,h);
    if (!data || isMuted) return;
    const barW = 3, gap = 1, count = Math.floor(w / (barW+gap)), step = Math.floor(data.length / count) || 1;
    ctx.fillStyle = isCapture ? '#7c3aed' : '#2563eb';
    for(let i=0; i<count; i++) {
        const val = data[i*step] || 0;
        const barH = (val / 255) * h * 0.9;
        if(barH > 1) ctx.fillRect(i*(barW+gap), h - barH, barW, barH);
    }
}

function drawEqCurve(ctx, values, cache) {
    if (!cache.isValid) return;
    const w = cache.width; const h = cache.height;
    const points = [];
    points.push({ x: -20, y: cache.midY - (values[0] * cache.scaleFactor) }); 
    for (let i = 0; i < 10; i++) points.push({ x: cache.xCoords[i], y: cache.midY - (values[i] * cache.scaleFactor) });
    points.push({ x: w + 20, y: cache.midY - (values[9] * cache.scaleFactor) }); 

    ctx.resetTransform(); ctx.scale(cache.dpr, cache.dpr); ctx.clearRect(0, 0, w, h);
    const path = new Path2D(); if (points.length < 2) return;
    path.moveTo(points[0].x, points[0].y);
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i===0?0:i-1], p1 = points[i], p2 = points[i+1], p3 = points[i+2]||p2; 
        const t = 0.5; 
        const cp1x = p1.x + (p2.x-p0.x)*t*0.33, cp1y = p1.y + (p2.y-p0.y)*t*0.33;
        const cp2x = p2.x - (p3.x-p1.x)*t*0.33, cp2y = p2.y - (p3.y-p1.y)*t*0.33;
        path.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
    const fillPath = new Path2D(path); fillPath.lineTo(w, h); fillPath.lineTo(0, h); fillPath.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(37, 99, 235, 0.25)'); grad.addColorStop(1, 'rgba(37, 99, 235, 0.0)');
    ctx.fillStyle = grad; ctx.fill(fillPath);
    ctx.shadowColor = "rgba(37, 99, 235, 0.5)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2; ctx.lineWidth = 2.5; ctx.strokeStyle = '#2563eb'; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(path);
}

document.addEventListener('DOMContentLoaded', async () => {
    let activeTab = null;
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        activeTab = tabs[0];
    } catch(e) {}

    const viewMain = document.getElementById('view-main');
    const viewSet = document.getElementById('view-settings');
    const btnSet = document.getElementById('btn-settings');
    const btnBack = document.getElementById('btn-back');
    const btnShort = document.getElementById('btn-shortcuts');
    
    if (btnShort) btnShort.onclick = () => chrome.tabs.create({url:'chrome://extensions/shortcuts'});
    if (btnSet) btnSet.onclick = () => { viewMain.classList.remove('active'); viewSet.classList.add('active'); };
    if (btnBack) btnBack.onclick = () => { viewSet.classList.remove('active'); viewMain.classList.add('active'); };

    const swOsd = document.getElementById('set-osd');
    const swViz = document.getElementById('set-viz');
    const selLang = document.getElementById('set-lang');
    const txtRegistry = document.getElementById('set-registry');
    const groupRegistry = document.getElementById('registry-group');
    const btnSaveReg = document.getElementById('btn-save-registry');

    const storage = await chrome.storage.local.get(['globalSettings', 'userRegistry']);
    // 更新模块级 gSettings
    if (storage.globalSettings) gSettings = storage.globalSettings;
    let userRegistry = storage.userRegistry;
    
    // Sync: Merge Defaults if userRegistry is empty/undefined, or just show merged list
    // Policy: We display the UNION of User Registry and Defaults.
    const effectiveList = Array.from(new Set([...(userRegistry || []), ...DEFAULT_DEFAULTS]));

    if (swOsd) swOsd.checked = gSettings.osdEnabled;
    if (swViz) swViz.checked = gSettings.visualizerEnabled !== false; // Default true
    if (selLang) selLang.value = gSettings.lang;
    if (txtRegistry) txtRegistry.value = effectiveList.join('\n');
    
    if (groupRegistry) {
        groupRegistry.style.display = (gSettings.visualizerEnabled !== false) ? 'block' : 'none';
    }

    const applyLang = () => {
        const dict = I18N[gSettings.lang] || I18N['en-US'];
        document.querySelectorAll('[data-i18n]').forEach(el => { if (dict[el.dataset.i18n]) el.innerText = dict[el.dataset.i18n]; });
        return dict;
    };
    let dict = applyLang();

    const saveSettings = () => {
        gSettings = { 
            osdEnabled: swOsd ? swOsd.checked : true, 
            visualizerEnabled: swViz ? swViz.checked : true,
            lang: selLang ? selLang.value : 'en-US' 
        };
        
        if (groupRegistry) {
            groupRegistry.style.display = gSettings.visualizerEnabled ? 'block' : 'none';
        }
        chrome.storage.local.set({ globalSettings: gSettings });
        chrome.tabs.query({}, (tabs) => { tabs.forEach(t => chrome.tabs.sendMessage(t.id, { action: "globalSettingsUpdate", settings: gSettings }).catch(()=>{})); });
        dict = applyLang();
        document.querySelectorAll('.glass-card').forEach(card => {
             const keys = ['comp', 'bass', 'mono', 'eqTitle'];
             keys.forEach(k => { const el = card.querySelector(`[data-i18n="${k}"]`); if(el) el.innerText = dict[k]; });
             const btnSave = card.querySelector('.btn-save'), btnReset = card.querySelector('.btn-reset');
             if (btnSave) { btnSave.innerText = dict.save; btnSave.title = dict.saveTooltip; }
             if (btnReset) { btnReset.innerText = dict.reset; btnReset.title = dict.resetTooltip; }
             const maskText = card.querySelector('.sleep-text');
             if (maskText) maskText.innerHTML = `<div>${dict.paused}</div><div style="font-size:11px; opacity:0.7; margin-top:4px; font-weight:400;">${dict.clickToResume}</div>`;
             
             // Dynamic UI Toggle
             const vizIsland = card.querySelector('.viz-island');
             if (vizIsland) vizIsland.classList.toggle('hidden', gSettings.visualizerEnabled === false);
        });
        
        // 触发所有卡片的 render 回调，更新颜色状态
        cardRenderCallbacks.forEach(cb => cb());
    };
    if (swOsd) swOsd.onchange = saveSettings;
    if (swViz) swViz.onchange = saveSettings;
    if (selLang) selLang.onchange = saveSettings;

    if (btnSaveReg) {
        btnSaveReg.onclick = () => {
            const lines = txtRegistry.value.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            chrome.storage.local.set({ userRegistry: lines }, () => {
                const originalText = btnSaveReg.innerText;
                btnSaveReg.innerText = "OK!";
                setTimeout(() => btnSaveReg.innerText = originalText, 1000);
            });
        };
    }

    const mainStage = document.getElementById('main-stage');
    const bgStack = document.getElementById('bg-stack');
    const bgHeader = document.getElementById('bg-header');
    const bgBadge = document.getElementById('bg-badge');
    const tmpl = document.getElementById('tmpl-card');
    const emptyState = document.getElementById('empty-state');

    const isRestricted = (url) => {
        if (!url) return true;
        return url.startsWith('chrome:') || url.startsWith('edge:') || url.startsWith('about:') || url.startsWith('chrome-extension:');
    };

    if (activeTab && !isRestricted(activeTab.url)) {
         try {
             const port = chrome.tabs.connect(activeTab.id, {name: "popup-connection"});
             port.onDisconnect.addListener(() => {
                 // 必须检查 lastError 来阻止错误被抛出到控制台
                 void chrome.runtime.lastError;
             }); 
         } catch(e) {
             // 静默处理：content script 可能尚未加载
         }
         
         if (await initCard(mainStage, tmpl, activeTab, dict, userRegistry)) {
             emptyState.classList.add('hidden');
         } else {
             emptyState.classList.remove('hidden');
         }
    } else {
         emptyState.classList.remove('hidden');
    }

    const audibles = await chrome.tabs.query({ audible: true });
    for (const tab of audibles) {
        if (activeTab && tab.id === activeTab.id) continue;
        if (isRestricted(tab.url)) continue; 
        if (await initCard(bgStack, tmpl, tab, dict, userRegistry)) {
             bgHeader.classList.remove('hidden'); 
        }
    }
    bgBadge.innerText = bgStack.children.length;
});

async function initCard(container, tmpl, tab, dict, userRegistry) {
    if (!await ensureInjected(tab.id)) return false;

    const status = await sendToTab(tab.id, { action: "getStatus" });
    const isCaptureActive = await chrome.runtime.sendMessage({ action: "getCaptureState", tabId: tab.id }).catch(()=>false);
    
    if ((!status || !status.hasAudio) && !tab.audible && !isCaptureActive) return false;
    
    const card = tmpl.content.cloneNode(true).querySelector('.glass-card');
    container.appendChild(card);
    
    let config = status ? clean(status.config) : { ...DEFAULT };
    const domain = getDomain(tab.url);
    
    // =====================================================
    // 核心修复：动态 Capture 状态判断
    // 问题1：首次打开时 Capture 尚未启动完成，getCaptureState 返回 false
    // 问题2：关闭频谱后需要根据音量动态切换颜色
    // 解决：使用动态计算函数，在每次渲染时重新计算 capturing 状态
    // =====================================================
    const RESTRICTED_DOMAINS = ['douyin.com', 'live.douyin.com', 'netflix.com', 'spotify.com', 'disneyplus.com', 'hulu.com'];
    const effectiveRegistry = Array.from(new Set([...(userRegistry || []), ...RESTRICTED_DOMAINS]));
    const isRestrictedSite = effectiveRegistry.some(d => domain.includes(d) || d.includes(domain));
    
    // 动态状态跟踪
    let isCaptureActiveLocal = isCaptureActive; // 本地缓存的 capture 状态
    
    // 动态计算 capturing 状态的函数
    // 每次 render 时调用，确保颜色与实际模式同步
    const getCapturing = () => {
        const vizOn = gSettings && gSettings.visualizerEnabled !== false;
        // 对于受限站点：
        // - 频谱开启 -> 必定 CAPTURE 模式
        // - 频谱关闭 + 音量 > 100 -> CAPTURE 模式
        // - 频谱关闭 + 音量 <= 100 -> NATIVE 模式
        const predictedCapture = isRestrictedSite && (vizOn || (config.volume > 100));
        return isCaptureActiveLocal || (status && status.mode === 'CAPTURE') || predictedCapture;
    };
    
    // 用于首次延迟启动 loop 的判断（静态快照）
    const initialPredictedCapture = isRestrictedSite && ((gSettings && gSettings.visualizerEnabled !== false) || (config.volume > 100));

    const sliderRow = card.querySelector('.eq-sliders-row');
    const eqCanvas = card.querySelector('.eq-curve-canvas');
    const ctx = eqCanvas.getContext('2d');
    
    const ui = {
        card, title: card.querySelector('.meta-title'), domain: card.querySelector('.meta-domain'), icon: card.querySelector('.meta-icon'),
        enable: card.querySelector('.sw-enable'), mask: card.querySelector('.sleep-mask'), maskText: card.querySelector('.sleep-text'),
        slider: card.querySelector('.vol-slider'), fill: card.querySelector('.slider-fill'), val: card.querySelector('.vol-number'),
        mute: card.querySelector('.btn-mute'), comp: card.querySelector('.sw-comp'), bass: card.querySelector('.sw-bass'), mono: card.querySelector('.sw-mono'),
        eqTrigger: card.querySelector('.eq-trigger'), eqDrawer: card.querySelector('.eq-drawer'), eqInputs: card.querySelectorAll('.eq-col input'), eqVals: card.querySelectorAll('.eq-val-display'),
        btnSave: card.querySelector('.btn-save'), btnReset: card.querySelector('.btn-reset'), canvas: card.querySelector('.viz-canvas'), sliderArea: card.querySelector('.slider-rail-container'),
        tComp: card.querySelector('[data-i18n="comp"]'), tBass: card.querySelector('[data-i18n="bass"]'), tMono: card.querySelector('[data-i18n="mono"]'), tEq: card.querySelector('[data-i18n="eqTitle"]'),
        vizIsland: card.querySelector('.viz-island') 
    };

    if (ui.vizIsland) ui.vizIsland.classList.toggle('hidden', gSettings && gSettings.visualizerEnabled === false);
    
    // 注册 render 回调到全局数组，供 saveSettings 调用
    // 注意：render 尚未定义，会在下面定义后通过闭包引用
    let renderCallback = null;

    let renderRef = null; 
    const metrics = new MetricsCache(sliderRow, eqCanvas, () => { if(renderRef) renderRef(); });

    ui.tComp.innerText = dict.comp; ui.tBass.innerText = dict.bass; ui.tMono.innerText = dict.mono; ui.tEq.innerText = dict.eqTitle;
    ui.btnSave.innerText = dict.save; ui.btnSave.title = dict.saveTooltip;
    ui.btnReset.innerText = dict.reset; ui.btnReset.title = dict.resetTooltip;
    ui.maskText.innerHTML = `<div>${dict.paused}</div><div style="font-size:11px; opacity:0.7; margin-top:4px; font-weight:400;">${dict.clickToResume}</div>`;
    ui.title.innerText = tab.title; ui.title.title = tab.title; ui.domain.innerText = domain; ui.icon.src = tab.favIconUrl || 'icon.png';

    // ===============================================
    // 核心修复：建立更稳健的连接机制
    // ===============================================
    
    // 连接状态标识
    let isConnected = false;

    // 尝试建立连接 (带重试机制)
    const connectToTab = async (tabId) => {
        try {
            // 1. 即使是 Native 模式，也建议保持一个 Port 连接以感知页面生命周期
            const port = chrome.tabs.connect(tabId, {name: "popup-connection"});
            port.onDisconnect.addListener(() => {
                // 必须检查 lastError 来阻止错误被抛出到控制台
                void chrome.runtime.lastError;
                isConnected = false;
            });
            return port;
        } catch(e) {
            // 静默处理
            return null;
        }
    };

    // 初始渲染函数
    const render = () => {
        if (!ui.card) return; // 防御性检查

        const disabled = !config.enabled; 
        const muted = config.muted;
        
        ui.card.classList.toggle('disabled', disabled); 
        ui.card.classList.toggle('muted', muted);
        ui.mask.classList.toggle('hidden', !disabled); 
        ui.enable.checked = config.enabled;

        ui.slider.value = config.volume;
        ui.fill.style.width = (config.volume / 800 * 100) + '%';
        ui.val.innerText = muted ? 'MUTE' : config.volume + '%';
        ui.mute.classList.toggle('active', muted);
        
        // 动态计算当前 capturing 状态
        const currentCapturing = getCapturing();
        
        if (currentCapturing) {
            ui.fill.style.backgroundColor = (muted || config.volume === 0) ? '#9ca3af' : '#7c3aed';
            ui.val.style.color = (muted || config.volume === 0) ? '#9ca3af' : '#7c3aed';
        } else {
            ui.fill.style.backgroundColor = (muted || config.volume === 0) ? '#9ca3af' : ''; 
            ui.val.style.color = (muted || config.volume === 0) ? '#9ca3af' : '';
        }

        // Logic for Volume Icon in Popup (3-state)
        // Mute -> 🔇 | Vol <= 100 -> 🔊 | Vol > 100 -> 🚀
        ui.mute.innerHTML = ''; // Clear icon
        const iconSpan = document.createElement('span');
        iconSpan.style.fontSize = '16px';
        
        // Treat Volume 0 as Mute visually
        if (muted || config.volume === 0) {
            iconSpan.innerText = '🔇';
            ui.mute.style.opacity = '0.7';
        } else {
             ui.mute.style.opacity = '1';
             iconSpan.innerText = config.volume > 100 ? '🚀' : '🔊';
        }
        ui.mute.appendChild(iconSpan);

        ui.comp.checked = config.compressor; 
        ui.bass.checked = config.bass; 
        ui.mono.checked = config.mono;
        
        // 更新 EQ 滑块
        ui.eqInputs.forEach((inp, i) => {
            // 避免在用户拖动时强制重写导致抖动
            if (document.activeElement !== inp) {
                inp.value = config.eqValues[i]; 
            }
            const v = config.eqValues[i];
            ui.eqVals[i].innerText = (v > 0 ? '+' : '') + v.toFixed(1); 
            ui.eqVals[i].style.color = v === 0 ? '#9ca3af' : '#2563eb';
        });
        
        // 绘制曲线
        drawEqCurve(ctx, config.eqValues, metrics);
        
        // 动态更新 vizIsland 隐藏状态
        if (ui.vizIsland) ui.vizIsland.classList.toggle('hidden', gSettings && gSettings.visualizerEnabled === false);
    };
    renderRef = render;
    
    // 注册到全局回调数组
    renderCallback = render;
    cardRenderCallbacks.push(renderCallback);
    
    // 强制初始渲染
    render();

    // 2. 消息监听：处理来自 Content Script 的被动更新 (如快捷键调节)
    const onMessageListener = (msg, sender) => {
        // 过滤无关消息
        if (msg.action === "syncUI" && msg.config && (!sender.tab || sender.tab.id === tab.id)) {
            // 更新本地 Config
            config = msg.config; 
            render();
            // 如果处于开启状态，视觉上应该有反馈？(根据需求可选)
        }
        if (msg.action === "captureStateChange" && (msg.tabId === tab.id || (sender.tab && sender.tab.id === tab.id))) {
            isCaptureActiveLocal = msg.enabled;
            // Capture 状态变化对 UI 颜色有重大影响，立即重绘
            render();
        }
    };
    chrome.runtime.onMessage.addListener(onMessageListener);
    
    // 清理逻辑：在 UI 销毁时移除监听 (虽然 Popup 销毁会自动清理，但保持良好习惯)
    window.addEventListener('unload', () => {
        chrome.runtime.onMessage.removeListener(onMessageListener);
    });

    const update = (changes) => {
        config = { ...config, ...changes };
        if (getCapturing()) chrome.runtime.sendMessage({ action: "updateCaptureConfig", tabId: tab.id, config });
        sendToTab(tab.id, { action: "updateConfig", config });
        render();
    };

    ui.enable.onchange = (e) => {
        const en = e.target.checked;
        update({ enabled: en });
        if(!en && getCapturing()) {
            isCaptureActiveLocal = false;
            chrome.runtime.sendMessage({ action: "toggleCapture", tabId: tab.id, enabled: false, config });
            render();
        }
    };
    ui.mask.onclick = () => update({ enabled: true });
    
    const handleVol = (val) => {
        let v = parseInt(val);
        update({ volume: v, muted: false });
        
        // Removed duplicative strategy logic. 
        // content.js is now the single source of truth.
        // It will detect the volume change and request Capture if needed.
    };

    ui.slider.oninput = (e) => handleVol(e.target.value);
    ui.sliderArea.addEventListener('wheel', (e) => {
        e.preventDefault(); if(!config.enabled) return;
        let v = parseInt(ui.slider.value);
        v = (e.deltaY < 0) ? Math.min(v+10, 800) : Math.max(v-10, 0);
        handleVol(v);
    }, {passive:false});
    
    ui.mute.onclick = () => update({ muted: !config.muted });
    ui.comp.onchange = (e) => update({ compressor: e.target.checked });
    ui.bass.onchange = (e) => update({ bass: e.target.checked });
    ui.mono.onchange = (e) => update({ mono: e.target.checked });

    ui.eqTrigger.onclick = () => {
        ui.eqDrawer.classList.toggle('open');
        ui.eqTrigger.querySelector('.eq-arrow').innerText = ui.eqDrawer.classList.contains('open') ? '▲' : '▼';
        setTimeout(() => metrics.update(), 310);
    };
    
    ui.eqInputs.forEach((inp, i) => {
        inp.oninput = (e) => { const arr = [...config.eqValues]; arr[i] = parseFloat(e.target.value); update({ eqValues: arr }); };
        inp.parentElement.addEventListener('wheel', (e) => {
            e.preventDefault(); let v = parseFloat(inp.value); v = (e.deltaY < 0) ? Math.min(v+0.1, 12) : Math.max(v-0.1, -12);
            v = Math.round(v*10)/10; const arr = [...config.eqValues]; arr[i] = v; update({ eqValues: arr });
        }, {passive: false});
    });

    ui.btnSave.onclick = () => {
        // 手动保存逻辑：用户点击保存后，将当前域名配置写入存储
        chrome.storage.local.get(['siteSettings'], r => {
            const s = r.siteSettings || {}; s[domain] = config;
            chrome.storage.local.set({ siteSettings: s }, () => {
                const old = ui.btnSave.innerText; 
                ui.btnSave.innerText = "OK"; 
                setTimeout(() => ui.btnSave.innerText = old, 1000);
            });
        });
    };
    ui.btnReset.onclick = () => update(DEFAULT);

    if (document.body.contains(card)) {
        // 【卡顿修复】增加 isRequesting 锁，防止请求堆积
        let isRequesting = false;
        let lastDraw = 0;
        let loopStarted = false;
        
        const loop = async (timestamp) => {
            if (timestamp - lastDraw < 32) { // Cap at ~30 FPS
                requestAnimationFrame(loop);
                return;
            }
            lastDraw = timestamp;

            if (config.enabled && !config.muted) {
                if (!isRequesting) {
                    // Check Global Visualizer Setting
                    if (gSettings.visualizerEnabled === false) {
                        drawViz(ui.canvas, null, true, getCapturing());
                        requestAnimationFrame(loop);
                        return;
                    }

                    isRequesting = true;
                    let buffer = null;
                    const currentCapturing = getCapturing(); // 动态获取当前状态
                    try {
                        if (currentCapturing) {
                            // 首先尝试从 offscreen 获取 (Capture 模式)
                            const res = await chrome.runtime.sendMessage({ target: "offscreen", action: "getViz", tabId: tab.id }).catch(()=>null);
                            if (res && res.buffer) {
                                buffer = res.buffer;
                            } else {
                                // Fallback: 如果 offscreen 还没准备好，尝试从 content.js 获取
                                // 这在 Capture 初始化期间提供平滑过渡
                                const data = await sendToTab(tab.id, { action: "getVisualizerData" });
                                if (data) buffer = data.buffer;
                            }
                        } else {
                            const data = await sendToTab(tab.id, { action: "getVisualizerData" });
                            if (data) buffer = data.buffer;
                        }
                    } catch(e) {}
                    
                    drawViz(ui.canvas, buffer, false, currentCapturing);
                    isRequesting = false;
                }
            } else { 
                drawViz(ui.canvas, null, true, getCapturing()); 
            }
            requestAnimationFrame(loop);
        };
        
        // 延迟启动 loop，给 Capture 初始化留出时间
        // 对于 predictedCapture 的情况尤其重要
        const startLoop = () => {
            if (!loopStarted) {
                loopStarted = true;
                requestAnimationFrame(loop);
            }
        };
        
        // 如果是预测的 Capture 模式，稍微延迟启动以等待 Capture 完成
        if (initialPredictedCapture && !isCaptureActive) {
            setTimeout(startLoop, 300); // 给 Capture 300ms 初始化时间
        } else {
            startLoop();
        }
    }
    return true;
}