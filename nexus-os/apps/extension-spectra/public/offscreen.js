// offscreen.js - 负责 Capture 模式下的音频处理
const processors = new Map();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.target !== "offscreen") return;
    
    // 路由消息到对应的处理函数
    if (msg.action === "start") startCapture(msg.tabId, msg.streamId, msg.config);
    else if (msg.action === "stop") stopCapture(msg.tabId);
    else if (msg.action === "updateConfig") updateAudio(msg.tabId, msg.config);
    else if (msg.action === "getViz") {
        const p = processors.get(msg.tabId);
        if (p && p.analyser) {
            const data = new Uint8Array(p.analyser.frequencyBinCount);
            p.analyser.getByteFrequencyData(data);
            sendResponse({ buffer: Array.from(data) });
        } else sendResponse({ buffer: null });
        return true;
    }
});

// 核心函数：开始捕获并处理音频
async function startCapture(tabId, streamId, config) {
    if (processors.has(tabId)) return;
    try {
        // 1. 获取来自 Tab 的媒体流
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }, video: false
        });

        // 2. 创建 AudioContext
        // 注意：Offscreen 文档中也可能受到自动播放策略限制，需要检查 state
        const ctx = new AudioContext();
        
        // 3. 构建处理链路：Source -> Bass -> EQ -> Comp -> Gain -> Analyser -> Destination
        const source = ctx.createMediaStreamSource(stream);
        const gain = ctx.createGain();
        
        // 低音增强 (Bass Boost)
        const bass = ctx.createBiquadFilter(); 
        bass.type = 'lowshelf'; 
        bass.frequency.value = CONFIG.AUDIO.BASS_FREQUENCY;

        // 动态压缩器 (Compressor) - 防止爆音
        const comp = ctx.createDynamicsCompressor();
        
        // 分析器 (Visualizer)
        const analyser = ctx.createAnalyser(); 
        analyser.fftSize = CONFIG.AUDIO.FFT_SIZE;

        // 10段均衡器 (EQ)
        const eqNodes = CONFIG.AUDIO.EQ_FREQUENCIES.map(f => {
            const n = ctx.createBiquadFilter(); 
            n.type = 'peaking'; 
            n.frequency.value = f; 
            n.Q.value = CONFIG.AUDIO.EQ_Q; 
            return n;
        });

        // 4. 连接节点
        let head = source; 
        head.connect(bass); head = bass;
        eqNodes.forEach(n => { head.connect(n); head = n; });
        head.connect(comp); head = comp;
        head.connect(gain); head = gain; 
        head.connect(analyser); 
        analyser.connect(ctx.destination); // 输出到系统音频
        
        // 5. 强制 Resume AudioContext
        // 这是解决“完全失效”或“无声”的关键。某些版本 Chrome 会自动挂起无交互的 Context。
        if (ctx.state === 'suspended') {
            await ctx.resume();
        }

        // 保存处理器状态
        processors.set(tabId, { ctx, stream, gain, bass, comp, eqNodes, analyser });
        
        // 立即应用配置
        updateAudio(tabId, config);

    } catch (e) { console.error("Offscreen capture failed:", e); }
}

function stopCapture(tabId) {
    const p = processors.get(tabId);
    if (p) { 
        // 停止所有轨道以释放资源
        p.stream.getTracks().forEach(t => t.stop()); 
        p.ctx.close(); 
        processors.delete(tabId); 
    }
}

// 更新音频参数 (音量、EQ、特效)
function updateAudio(tabId, config) {
    const p = processors.get(tabId); if (!p) return;
    
    // 确保 AudioContext 处于运行状态
    if (p.ctx.state === 'suspended') p.ctx.resume();

    // 计算 Gain 值：
    // 0-100% -> 0.0-1.0
    // 100-800% -> 1.0-8.0
    const val = config.muted ? 0 : config.volume;
    const gainVal = val / 100; // 直接除以100即可满足线性映射需求
    
    const t = p.ctx.currentTime;
    const r = CONFIG.AUDIO.SMOOTH_TIME; // 平滑时间常数

    // 应用音量
    p.gain.gain.setTargetAtTime(gainVal, t, r);
    p.gain.channelCount = config.mono ? 1 : 2;

    // 应用低音
    p.bass.gain.setTargetAtTime(config.bass ? CONFIG.AUDIO.BASS_GAIN : 0, t, r);
    
    // 应用 EQ
    p.eqNodes.forEach((n, i) => { 
        n.gain.setTargetAtTime(config.eqValues[i] || 0, t, r); 
    });

    // 应用压缩器参数
    if (config.compressor) {
        p.comp.threshold.setTargetAtTime(CONFIG.AUDIO.COMPRESSOR.threshold, t, r);
        p.comp.knee.setTargetAtTime(CONFIG.AUDIO.COMPRESSOR.knee, t, r);
        p.comp.ratio.setTargetAtTime(CONFIG.AUDIO.COMPRESSOR.ratio, t, r);
        p.comp.attack.setTargetAtTime(CONFIG.AUDIO.COMPRESSOR.attack, t, r);
        p.comp.release.setTargetAtTime(CONFIG.AUDIO.COMPRESSOR.release, t, r);
    } else {
        // 关闭压缩器时，将其设置为透明模式 (不压缩)
        p.comp.threshold.setTargetAtTime(CONFIG.AUDIO.COMPRESSOR_OFF.threshold, t, r);
        p.comp.ratio.setTargetAtTime(CONFIG.AUDIO.COMPRESSOR_OFF.ratio, t, r);
    }
}