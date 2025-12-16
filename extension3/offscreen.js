// offscreen.js
const processors = new Map();
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.target !== "offscreen") return;
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
async function startCapture(tabId, streamId, config) {
    if (processors.has(tabId)) return;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }, video: false
        });
        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const gain = ctx.createGain();
        const bass = ctx.createBiquadFilter(); bass.type = 'lowshelf'; bass.frequency.value = 200;
        const analyser = ctx.createAnalyser(); analyser.fftSize = 256;
        const eqNodes = [32,64,125,250,500,1000,2000,4000,8000,16000].map(f => {
            const n = ctx.createBiquadFilter(); n.type = 'peaking'; n.frequency.value = f; n.Q.value = 1.4; return n;
        });
        let head = source; head.connect(bass); head = bass;
        eqNodes.forEach(n => { head.connect(n); head = n; });
        head.connect(gain); head = gain; head.connect(analyser); analyser.connect(ctx.destination);
        processors.set(tabId, { ctx, stream, gain, bass, eqNodes, analyser });
        updateAudio(tabId, config);
    } catch (e) { console.error(e); }
}
function stopCapture(tabId) {
    const p = processors.get(tabId);
    if (p) { p.stream.getTracks().forEach(t => t.stop()); p.ctx.close(); processors.delete(tabId); }
}
function updateAudio(tabId, config) {
    const p = processors.get(tabId); if (!p) return;
    const val = config.volume; const gainVal = val > 100 ? val / 100 : 1; 
    const t = p.ctx.currentTime;
    p.gain.gain.setTargetAtTime(gainVal, t, 0.1);
    p.bass.gain.setTargetAtTime(config.bass ? 10 : 0, t, 0.1);
    p.gain.channelCount = config.mono ? 1 : 2;
    p.eqNodes.forEach((n, i) => { n.gain.setTargetAtTime(config.eqValues[i] || 0, t, 0.1); });
}