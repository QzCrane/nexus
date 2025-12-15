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
    'en-US': { settingsTitle: "Settings", osdLabel: "OSD Popup", osdSub: "Overlay when using shortcuts", langLabel: "Language", noAudio: "No Audio Signal", bgTitle: "Background", paused: "Paused", comp: "Compressor", bass: "Bass", mono: "Mono", eqTitle: "🎚️ 10-Band EQ", reset: "Reset", save: "Save",
        // 新增详细提示
        resetTooltip: "Reset volume and EQ to default values (100% / Flat)",
        saveTooltip: "Save current settings as the default for this domain",
        paused: "Audio Enhancement Paused", // 更具体的文案
        clickToResume: "Click to Resume"    // 新增交互提示 
        },
    'zh-CN': { settingsTitle: "设置", osdLabel: "屏幕提示 (OSD)", osdSub: "快捷键调节时显示", langLabel: "语言 (Language)", noAudio: "无音频信号", bgTitle: "后台播放", paused: "已暂停", comp: "防爆音", bass: "低音", mono: "单声道", eqTitle: "🎚️ 10段均衡器", reset: "重置", save: "保存",
        // 新增详细提示
        resetTooltip: "将当前标签页的音量和均衡器恢复为默认值",
        saveTooltip: "将当前配置保存为该网站 (域名) 的永久默认配置",
        paused: "增强已暂停",
        clickToResume: "点击恢复" }
};

// --- 几何缓存 (修复初始化不显示问题) ---
class MetricsCache {
    constructor(rowElement, canvas, onChange) {
        this.row = rowElement;
        this.canvas = canvas;
        this.onChange = onChange; 
        this.xCoords = new Float32Array(10);
        this.midY = 0;
        this.width = 0;
        this.height = 0;
        this.dpr = 1;
        this.scaleFactor = 3.66; 
        this.isValid = false;
        
        // 1. 监听尺寸变化
        this.observer = new ResizeObserver(() => this.update());
        this.observer.observe(rowElement);
        
        // 2. 暴力轮询初始化 (前200ms密集检查，确保一定能画出来)
        this.update(); 
        const initLoop = (count) => {
            if (this.update() || count <= 0) return;
            requestAnimationFrame(() => initLoop(count - 1));
        };
        initLoop(20); // 尝试20帧
    }

    update() {
        const rect = this.row.getBoundingClientRect();
        // 如果还没渲染出来，直接返回 false
        if (rect.width === 0 || rect.height === 0) return false;

        const canvasRect = this.canvas.getBoundingClientRect();
        this.dpr = window.devicePixelRatio || 1;
        const physW = canvasRect.width * this.dpr;
        const physH = canvasRect.height * this.dpr;
        
        if (this.canvas.width !== physW || this.canvas.height !== physH) {
            this.canvas.width = physW;
            this.canvas.height = physH;
        }

        this.width = canvasRect.width;
        this.height = canvasRect.height;
        this.midY = (rect.top - canvasRect.top) + (rect.height / 2);

        const inputs = this.row.querySelectorAll('input');
        if (inputs.length > 0) {
            const inputRect = inputs[0].getBoundingClientRect();
            // 减去滑块 Thumb 的物理高度 (约12px)，因为滑块中心跑不到 Track 的顶端
            const trackTravel = inputRect.height - 12; 
            this.scaleFactor = trackTravel / 24; 
        }

        inputs.forEach((input, i) => {
            const r = input.getBoundingClientRect();
            this.xCoords[i] = (r.left - canvasRect.left) + (r.width / 2);
        });

        const wasInvalid = !this.isValid;
        this.isValid = true;

        // 只要变为有效，或者强制更新，就触发回调
        if (this.onChange) this.onChange();
        return true;
    }
}

/**
 * 贝塞尔曲线生成器 (Catmull-Rom)
 * 修正：张力系数 t = 0.3，减少过冲，更加紧致。
 */
function drawEqCurve(ctx, values, cache) {
    if (!cache.isValid) return;

    const w = cache.width;
    const h = cache.height;
    
    // 1. 数据准备
    const points = [];
    points.push({ x: -20, y: cache.midY - (values[0] * cache.scaleFactor) }); 
    for (let i = 0; i < 10; i++) {
        points.push({ 
            x: cache.xCoords[i], 
            y: cache.midY - (values[i] * cache.scaleFactor) 
        });
    }
    points.push({ x: w + 20, y: cache.midY - (values[9] * cache.scaleFactor) }); 

    // 2. 绘制路径
    ctx.resetTransform();
    ctx.scale(cache.dpr, cache.dpr);
    ctx.clearRect(0, 0, w, h);

    const path = new Path2D();
    if (points.length < 2) return;

    path.moveTo(points[0].x, points[0].y);

    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i === 0 ? 0 : i - 1];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[i + 2] || p2; 

        // 张力系数 (Tension): 范围通常在 0.0 到 1.0 之间
        // 0.5 = 标准 Catmull-Rom (较圆润，适合音乐欣赏)
        // 0.3 = 更紧致 (Overhsoot 小，适合精准修音)
        // 0.0 = 直线连接 (完全无圆润)
        const t = 0.5; 

        const cp1x = p1.x + (p2.x - p0.x) * t * 0.33;
        const cp1y = p1.y + (p2.y - p0.y) * t * 0.33;

        const cp2x = p2.x - (p3.x - p1.x) * t * 0.33;
        const cp2y = p2.y - (p3.y - p1.y) * t * 0.33;

        path.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }

    // 3. 渲染
    const fillPath = new Path2D(path);
    fillPath.lineTo(w, h);
    fillPath.lineTo(0, h);
    fillPath.closePath();

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(37, 99, 235, 0.25)'); 
    grad.addColorStop(0.6, 'rgba(37, 99, 235, 0.05)');
    grad.addColorStop(1, 'rgba(37, 99, 235, 0.0)');
    ctx.fillStyle = grad;
    ctx.fill(fillPath);

    ctx.shadowColor = "rgba(37, 99, 235, 0.5)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#2563eb';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(path);

    ctx.shadowColor = "transparent";
    ctx.beginPath();
    ctx.moveTo(0, cache.midY);
    ctx.lineTo(w, cache.midY);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
}

document.addEventListener('DOMContentLoaded', async () => {
    let activeTab = null;

    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        activeTab = tabs[0];
        if (activeTab && activeTab.id && activeTab.url && activeTab.url.startsWith('http')) {
            const port = chrome.tabs.connect(activeTab.id, { name: "popup-connection" });
            port.onDisconnect.addListener(() => { chrome.runtime.lastError; });
        }
    } catch(e) {}

    const viewMain = document.getElementById('view-main');
    const viewSet = document.getElementById('view-settings');
    const btnSet = document.getElementById('btn-settings');
    const btnBack = document.getElementById('btn-back');
    const btnShort = document.getElementById('btn-shortcuts');
    
    btnShort.onclick = () => chrome.tabs.create({url:'chrome://extensions/shortcuts'});
    btnSet.onclick = () => { viewMain.classList.remove('active'); viewSet.classList.add('active'); };
    btnBack.onclick = () => { viewSet.classList.remove('active'); viewMain.classList.add('active'); };

    const swOsd = document.getElementById('set-osd');
    const selLang = document.getElementById('set-lang');
    
    const storage = await chrome.storage.local.get(['globalSettings']);
    let gSettings = storage.globalSettings || { osdEnabled: true, lang: 'en-US' };

    swOsd.checked = gSettings.osdEnabled;
    selLang.value = gSettings.lang;

    const applyLang = () => {
        const dict = I18N[gSettings.lang] || I18N['en-US'];
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.dataset.i18n;
            if (dict[key]) el.innerText = dict[key];
        });
        return dict;
    };
    let dict = applyLang();

const saveSettings = () => {
        // 1. 保存设置
        gSettings = { osdEnabled: swOsd.checked, lang: selLang.value };
        chrome.storage.local.set({ globalSettings: gSettings });
        
        // 2. 通知后台
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach(t => chrome.tabs.sendMessage(t.id, { action: "globalSettingsUpdate", settings: gSettings }).catch(()=>{ chrome.runtime.lastError; }));
        });
        
        // 3. 重新获取当前语言包
        dict = applyLang();

        // 4. 暴力刷新当前页面所有已渲染卡片的文本
        document.querySelectorAll('.glass-card').forEach(card => {
             // (A) 更新普通的开关标签
             const keys = ['comp', 'bass', 'mono', 'eqTitle'];
             keys.forEach(k => {
                 const el = card.querySelector(`[data-i18n="${k}"]`);
                 if(el) el.innerText = dict[k];
             });

             // (B) 修复点：更新按钮的文本 AND 详细提示 (Tooltip)
             const btnSave = card.querySelector('.btn-save');
             const btnReset = card.querySelector('.btn-reset');
             
             if (btnSave) {
                 btnSave.innerText = dict.save;
                 btnSave.title = dict.saveTooltip; // 关键：立即刷新 title
             }
             if (btnReset) {
                 btnReset.innerText = dict.reset;
                 btnReset.title = dict.resetTooltip; // 关键：立即刷新 title
             }

             // (C) 修复点：更新遮罩层 (Mask) 的复杂结构
             const maskText = card.querySelector('.sleep-text');
             if (maskText) {
                 maskText.innerHTML = `
                    <div>${dict.paused}</div>
                    <div style="font-size:11px; opacity:0.7; margin-top:4px; font-weight:400;">${dict.clickToResume}</div>
                 `;
             }
        });
    };
    swOsd.onchange = saveSettings;
    selLang.onchange = saveSettings;

    const mainStage = document.getElementById('main-stage');
    const bgStack = document.getElementById('bg-stack');
    const bgHeader = document.getElementById('bg-header');
    const bgBadge = document.getElementById('bg-badge');
    const tmpl = document.getElementById('tmpl-card');
    const emptyState = document.getElementById('empty-state');

    const audibles = await chrome.tabs.query({ audible: true });
    const map = new Map();
    
    if (activeTab && activeTab.url && !activeTab.url.startsWith('chrome')) {
        map.set(activeTab.id, activeTab);
    }
    audibles.forEach(t => map.set(t.id, t));

    let count = 0;
    for (const tab of map.values()) {
        const isMain = (activeTab && tab.id === activeTab.id);
        const container = isMain ? mainStage : bgStack;
        if (await initCard(container, tmpl, tab, dict)) count++;
    }
    
    if (count === 0) emptyState.classList.remove('hidden');
    else emptyState.classList.add('hidden');
    if (bgStack.children.length > 0) {
        bgHeader.classList.remove('hidden');
        bgBadge.innerText = bgStack.children.length;
    }
});

function drawViz(canvas, data, isMuted) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0,0,w,h);
    if (!data || isMuted) return;
    const barW = 3; const gap = 1;
    const count = Math.floor(w / (barW+gap));
    const step = Math.floor(data.length / count);
    ctx.fillStyle = '#2563eb';
    for(let i=0; i<count; i++) {
        const val = data[i*step];
        const barH = (val / 255) * h * 0.9;
        if(barH > 1) ctx.fillRect(i*(barW+gap), h - barH, barW, barH);
    }
}

async function initCard(container, tmpl, tab, dict) {
    await ensureInjected(tab.id);
    const status = await sendToTab(tab.id, { action: "getStatus" });
    if ((!status || !status.hasAudio) && !tab.audible) return false;
    
    const card = tmpl.content.cloneNode(true).querySelector('.glass-card');
    container.appendChild(card);
    
    let config = status ? clean(status.config) : { ...DEFAULT };
    const domain = getDomain(tab.url);

    const sliderRow = card.querySelector('.eq-sliders-row');
    const eqCanvas = card.querySelector('.eq-curve-canvas');
    const ctx = eqCanvas.getContext('2d');
    
    const ui = {
        card,
        title: card.querySelector('.meta-title'),
        domain: card.querySelector('.meta-domain'),
        icon: card.querySelector('.meta-icon'),
        enable: card.querySelector('.sw-enable'),
        mask: card.querySelector('.sleep-mask'),
        maskText: card.querySelector('.sleep-text'), // 新增获取 mask 文本元素
        slider: card.querySelector('.vol-slider'),
        fill: card.querySelector('.slider-fill'),
        val: card.querySelector('.vol-number'),
        mute: card.querySelector('.btn-mute'),
        comp: card.querySelector('.sw-comp'),
        bass: card.querySelector('.sw-bass'),
        mono: card.querySelector('.sw-mono'),
        eqTrigger: card.querySelector('.eq-trigger'),
        eqDrawer: card.querySelector('.eq-drawer'),
        eqInputs: card.querySelectorAll('.eq-col input'),
        eqVals: card.querySelectorAll('.eq-val-display'),
        btnSave: card.querySelector('.btn-save'),
        btnReset: card.querySelector('.btn-reset'),
        canvas: card.querySelector('.viz-canvas'),
        sliderArea: card.querySelector('.slider-rail-container'),
        tComp: card.querySelector('[data-i18n="comp"]'),
        tBass: card.querySelector('[data-i18n="bass"]'),
        tMono: card.querySelector('[data-i18n="mono"]'),
        tEq: card.querySelector('[data-i18n="eqTitle"]')
    };

    let renderRef = null; 
    
    // 初始化 Cache，使用闭包安全调用 renderRef
    const metrics = new MetricsCache(sliderRow, eqCanvas, () => {
        if(renderRef) renderRef(); 
    });

    ui.tComp.innerText = dict.comp; ui.tBass.innerText = dict.bass;
    ui.tMono.innerText = dict.mono; ui.tEq.innerText = dict.eqTitle;
    ui.btnSave.innerText = dict.save; ui.btnSave.title = dict.saveTooltip;
    ui.btnReset.innerText = dict.reset; ui.btnReset.title = dict.resetTooltip; // 关键：鼠标悬停显示详细解释

    // 4. 更新遮罩层的文案和结构
    // 建议在 HTML 模板中给 sleep-content 增加一个副标题 div，或者这里直接改写 innerHTML
    ui.maskText.innerHTML = `
        <div>${dict.paused}</div>
        <div style="font-size:11px; opacity:0.7; margin-top:4px; font-weight:400;">${dict.clickToResume}</div>
    `;

    ui.title.innerText = tab.title; ui.title.title = tab.title;
    ui.domain.innerText = domain; ui.icon.src = tab.favIconUrl || 'icon.png';

    const render = () => {
        const disabled = !config.enabled; const muted = config.muted;
        ui.card.classList.toggle('disabled', disabled);
        ui.card.classList.toggle('muted', muted);
        ui.mask.classList.toggle('hidden', !disabled);
        ui.enable.checked = config.enabled;

        ui.slider.value = config.volume;
        ui.fill.style.width = (config.volume / 800 * 100) + '%';
        ui.val.innerText = muted ? 'MUTE' : config.volume + '%';
        ui.mute.classList.toggle('active', muted);
        
        ui.comp.checked = config.compressor;
        ui.bass.checked = config.bass;
        ui.mono.checked = config.mono;
        
        ui.eqInputs.forEach((inp, i) => {
            inp.value = config.eqValues[i];
            const v = config.eqValues[i];
            ui.eqVals[i].innerText = (v > 0 ? '+' : '') + v.toFixed(1);
            ui.eqVals[i].style.color = v === 0 ? '#9ca3af' : '#2563eb';
        });
        
        drawEqCurve(ctx, config.eqValues, metrics);
    };
    
    renderRef = render;
    requestAnimationFrame(render);

    const msgListener = (msg, sender) => {
        if (msg.action === "syncUI" && msg.config) {
            if (sender.tab && sender.tab.id === tab.id) {
                config = msg.config;
                render();
            }
        }
    };
    chrome.runtime.onMessage.addListener(msgListener);

    const update = (changes) => {
        config = { ...config, ...changes };
        render();
        sendToTab(tab.id, { action: "updateConfig", config });
    };

    ui.enable.onchange = (e) => update({ enabled: e.target.checked });
    ui.mask.onclick = () => update({ enabled: true });
    ui.slider.oninput = (e) => update({ volume: parseInt(e.target.value), muted: false });
    ui.sliderArea.addEventListener('wheel', (e) => {
        e.preventDefault(); if(!config.enabled) return;
        let v = parseInt(ui.slider.value);
        v = (e.deltaY < 0) ? Math.min(v+10, 800) : Math.max(v-10, 0);
        update({ volume: v, muted: false });
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
        inp.oninput = (e) => {
            const arr = [...config.eqValues]; arr[i] = parseFloat(e.target.value); update({ eqValues: arr });
        };
        inp.parentElement.addEventListener('wheel', (e) => {
            e.preventDefault(); let v = parseFloat(inp.value);
            v = (e.deltaY < 0) ? Math.min(v+0.1, 12) : Math.max(v-0.1, -12);
            v = Math.round(v*10)/10;
            const arr = [...config.eqValues]; arr[i] = v; update({ eqValues: arr });
        }, {passive: false});
    });

    ui.btnSave.onclick = () => {
        chrome.storage.local.get(['siteSettings'], r => {
            const s = r.siteSettings || {}; s[domain] = config;
            chrome.storage.local.set({ siteSettings: s }, () => {
                const old = ui.btnSave.innerText; ui.btnSave.innerText = "OK";
                setTimeout(() => ui.btnSave.innerText = old, 1000);
            });
        });
    };
    ui.btnReset.onclick = () => update(DEFAULT);

    if (document.body.contains(card)) {
        const loop = async () => {
            if (config.enabled && !config.muted) {
                const data = await sendToTab(tab.id, { action: "getVisualizerData" });
                if (data && data.buffer) drawViz(ui.canvas, data.buffer, false);
            } else { drawViz(ui.canvas, null, true); }
            requestAnimationFrame(loop);
        };
        loop();
    }
    return true;
}