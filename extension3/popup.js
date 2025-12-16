/**
 * Media Master 2026 - Restore & Boost
 * Based on User Backup + Hybrid Engine Injection
 */

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

const I18N = {
    'en-US': { settingsTitle: "Settings", osdLabel: "OSD Popup", osdSub: "Overlay when using shortcuts", langLabel: "Language", noAudio: "No Audio Signal", bgTitle: "Background", paused: "Paused", comp: "Compressor", bass: "Bass", mono: "Mono", eqTitle: "🎚️ 10-Band EQ", reset: "Reset", save: "Save", resetTooltip: "Reset volume and EQ to default values (100% / Flat)", saveTooltip: "Save current settings as the default for this domain", paused: "Audio Enhancement Paused", clickToResume: "Click to Resume" },
    'zh-CN': { settingsTitle: "设置", osdLabel: "屏幕提示 (OSD)", osdSub: "快捷键调节时显示", langLabel: "语言 (Language)", noAudio: "无音频信号", bgTitle: "后台播放", paused: "已暂停", comp: "防爆音", bass: "低音", mono: "单声道", eqTitle: "🎚️ 10段均衡器", reset: "重置", save: "保存", resetTooltip: "将当前标签页的音量和均衡器恢复为默认值", saveTooltip: "将当前配置保存为该网站 (域名) 的永久默认配置", paused: "增强已暂停", clickToResume: "点击恢复" }
};

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

// 增加 isCapture 参数来改变颜色
function drawViz(canvas, data, isMuted, isCapture) {
    const ctx = canvas.getContext('2d'); const w = canvas.width, h = canvas.height; ctx.clearRect(0,0,w,h);
    if (!data || isMuted) return;
    const barW = 3, gap = 1, count = Math.floor(w / (barW+gap)), step = Math.floor(data.length / count) || 1;
    // 捕获模式用紫色，普通模式用蓝色
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
    
    // 【防崩修复】增加安全检查，如果 HTML 里没有这些 ID 也不要报错
    if (btnShort) btnShort.onclick = () => chrome.tabs.create({url:'chrome://extensions/shortcuts'});
    if (btnSet) btnSet.onclick = () => { viewMain.classList.remove('active'); viewSet.classList.add('active'); };
    if (btnBack) btnBack.onclick = () => { viewSet.classList.remove('active'); viewMain.classList.add('active'); };

    const swOsd = document.getElementById('set-osd');
    const selLang = document.getElementById('set-lang');
    const storage = await chrome.storage.local.get(['globalSettings']);
    let gSettings = storage.globalSettings || { osdEnabled: true, lang: 'en-US' };

    if (swOsd) swOsd.checked = gSettings.osdEnabled;
    if (selLang) selLang.value = gSettings.lang;

    const applyLang = () => {
        const dict = I18N[gSettings.lang] || I18N['en-US'];
        document.querySelectorAll('[data-i18n]').forEach(el => { if (dict[el.dataset.i18n]) el.innerText = dict[el.dataset.i18n]; });
        return dict;
    };
    let dict = applyLang();

    const saveSettings = () => {
        gSettings = { osdEnabled: swOsd ? swOsd.checked : true, lang: selLang ? selLang.value : 'en-US' };
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
        });
    };
    if (swOsd) swOsd.onchange = saveSettings;
    if (selLang) selLang.onchange = saveSettings;

    const mainStage = document.getElementById('main-stage');
    const bgStack = document.getElementById('bg-stack');
    const bgHeader = document.getElementById('bg-header');
    const bgBadge = document.getElementById('bg-badge');
    const tmpl = document.getElementById('tmpl-card');
    const emptyState = document.getElementById('empty-state');

    const audibles = await chrome.tabs.query({ audible: true });
    const map = new Map();
    if (activeTab && activeTab.url && !activeTab.url.startsWith('chrome')) map.set(activeTab.id, activeTab);
    audibles.forEach(t => map.set(t.id, t));

    let count = 0;
    for (const tab of map.values()) {
        const isMain = (activeTab && tab.id === activeTab.id);
        const container = isMain ? mainStage : bgStack;
        if (await initCard(container, tmpl, tab, dict)) count++;
    }
    
    if (count === 0) emptyState.classList.remove('hidden'); else emptyState.classList.add('hidden');
    if (bgStack.children.length > 0) { bgHeader.classList.remove('hidden'); bgBadge.innerText = bgStack.children.length; }
});

async function initCard(container, tmpl, tab, dict) {
    await ensureInjected(tab.id);
    const status = await sendToTab(tab.id, { action: "getStatus" });
    
    // 【修改点 1】: 检查捕获状态，如果有捕获也要渲染
    const isCaptureActive = await chrome.runtime.sendMessage({ action: "getCaptureState", tabId: tab.id }).catch(()=>false);
    if ((!status || !status.hasAudio) && !tab.audible && !isCaptureActive) return false;
    
    const card = tmpl.content.cloneNode(true).querySelector('.glass-card');
    container.appendChild(card);
    
    let config = status ? clean(status.config) : { ...DEFAULT };
    const domain = getDomain(tab.url);
    
    // 【修改点 2】: 本地维护捕获状态
    let capturing = isCaptureActive;

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
        tComp: card.querySelector('[data-i18n="comp"]'), tBass: card.querySelector('[data-i18n="bass"]'), tMono: card.querySelector('[data-i18n="mono"]'), tEq: card.querySelector('[data-i18n="eqTitle"]')
    };

    let renderRef = null; 
    const metrics = new MetricsCache(sliderRow, eqCanvas, () => { if(renderRef) renderRef(); });

    ui.tComp.innerText = dict.comp; ui.tBass.innerText = dict.bass; ui.tMono.innerText = dict.mono; ui.tEq.innerText = dict.eqTitle;
    ui.btnSave.innerText = dict.save; ui.btnSave.title = dict.saveTooltip;
    ui.btnReset.innerText = dict.reset; ui.btnReset.title = dict.resetTooltip;
    ui.maskText.innerHTML = `<div>${dict.paused}</div><div style="font-size:11px; opacity:0.7; margin-top:4px; font-weight:400;">${dict.clickToResume}</div>`;
    ui.title.innerText = tab.title; ui.title.title = tab.title; ui.domain.innerText = domain; ui.icon.src = tab.favIconUrl || 'icon.png';

    const render = () => {
        const disabled = !config.enabled; const muted = config.muted;
        ui.card.classList.toggle('disabled', disabled); ui.card.classList.toggle('muted', muted);
        ui.mask.classList.toggle('hidden', !disabled); ui.enable.checked = config.enabled;

        ui.slider.value = config.volume;
        ui.fill.style.width = (config.volume / 800 * 100) + '%';
        ui.val.innerText = muted ? 'MUTE' : config.volume + '%';
        ui.mute.classList.toggle('active', muted);
        
        // 【修改点 3】: 视觉反馈 (捕获模式变紫)
        if (capturing) {
            ui.fill.style.backgroundColor = '#7c3aed';
            ui.val.style.color = '#7c3aed';
        } else {
            ui.fill.style.backgroundColor = ''; 
            ui.val.style.color = '';
        }

        ui.comp.checked = config.compressor; ui.bass.checked = config.bass; ui.mono.checked = config.mono;
        ui.eqInputs.forEach((inp, i) => {
            inp.value = config.eqValues[i]; const v = config.eqValues[i];
            ui.eqVals[i].innerText = (v > 0 ? '+' : '') + v.toFixed(1); ui.eqVals[i].style.color = v === 0 ? '#9ca3af' : '#2563eb';
        });
        drawEqCurve(ctx, config.eqValues, metrics);
    };
    renderRef = render; render();

    chrome.runtime.onMessage.addListener((msg, sender) => {
        if (msg.action === "syncUI" && msg.config && sender.tab && sender.tab.id === tab.id) {
            config = msg.config; render();
        }
    });

    // 【修改点 4】: 核心切换逻辑
    const update = (changes) => {
        config = { ...config, ...changes };
        
        // --- 阈值判断 ---
        if (typeof changes.volume === 'number') {
            if (changes.volume > 100 && !capturing) {
                capturing = true;
                chrome.runtime.sendMessage({ action: "toggleCapture", tabId: tab.id, enabled: true, config });
            } else if (changes.volume <= 100 && capturing) {
                capturing = false;
                chrome.runtime.sendMessage({ action: "toggleCapture", tabId: tab.id, enabled: false, config });
            }
        }
        // 同步配置给 Capture 引擎
        if (capturing) {
            chrome.runtime.sendMessage({ action: "updateCaptureConfig", tabId: tab.id, config });
        }
        
        render();
        sendToTab(tab.id, { action: "updateConfig", config });
    };

    ui.enable.onchange = (e) => {
        const en = e.target.checked;
        update({ enabled: en });
        if(!en && capturing) {
            capturing = false;
            chrome.runtime.sendMessage({ action: "toggleCapture", tabId: tab.id, enabled: false, config });
            render();
        }
    };
    ui.mask.onclick = () => update({ enabled: true });
    
    const handleVol = (val) => {
        let v = parseInt(val);
        update({ volume: v, muted: false });
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
        chrome.storage.local.get(['siteSettings'], r => {
            const s = r.siteSettings || {}; s[domain] = config;
            chrome.storage.local.set({ siteSettings: s }, () => {
                const old = ui.btnSave.innerText; ui.btnSave.innerText = "OK"; setTimeout(() => ui.btnSave.innerText = old, 1000);
            });
        });
    };
    ui.btnReset.onclick = () => update(DEFAULT);

    if (document.body.contains(card)) {
        // 【修改点 5】: 可视化数据双源切换
        const loop = async () => {
            if (config.enabled && !config.muted) {
                let buffer = null;
                if (capturing) {
                    const res = await chrome.runtime.sendMessage({ target: "offscreen", action: "getViz", tabId: tab.id }).catch(()=>null);
                    if (res) buffer = res.buffer;
                } else {
                    const data = await sendToTab(tab.id, { action: "getVisualizerData" });
                    if (data) buffer = data.buffer;
                }
                drawViz(ui.canvas, buffer, false, capturing);
            } else { drawViz(ui.canvas, null, true, capturing); }
            requestAnimationFrame(loop);
        };
        loop();
    }
    return true;
}