(function() {
  const originalCreateElement = document.createElement;
  const originalCreateElementNS = document.createElementNS;
  const OriginalAudio = window.Audio;

  // 1-3: 劫持 createElement / createElementNS / Audio
  document.createElement = function(tagName, options) {
    const element = originalCreateElement.call(this, tagName, options);
    if (tagName && (tagName.toLowerCase() === 'video' || tagName.toLowerCase() === 'audio')) {
      element.setAttribute('crossorigin', 'anonymous');
    }
    return element;
  };

  document.createElementNS = function(ns, tagName, options) {
    const element = originalCreateElementNS.call(this, ns, tagName, options);
    if (tagName && (tagName.toLowerCase() === 'video' || tagName.toLowerCase() === 'audio')) {
      element.setAttribute('crossorigin', 'anonymous');
    }
    return element;
  };

  window.Audio = function(src) {
    const element = new OriginalAudio(src);
    element.setAttribute('crossorigin', 'anonymous');
    return element;
  };
  window.Audio.prototype = OriginalAudio.prototype;

  // ==============================================================
  // 4. 全屏拦截 - 延迟执行方案
  // ==============================================================
  const originalRequestFullscreen = Element.prototype.requestFullscreen;
  const originalWebkitRequestFullscreen = Element.prototype.webkitRequestFullscreen;

  function setAllMediaVolume(vol) {
    document.querySelectorAll('video, audio').forEach(function(el) {
      try { el.volume = vol; el.muted = false; } catch (e) {}
    });
  }

  // 监听 fullscreenchange
  document.addEventListener('fullscreenchange', function() {
    if (document.fullscreenElement) {
      window.postMessage({ type: 'SPECTRA_FULLSCREEN_ENTERED' }, '*');
    }
  });

  // 全屏拦截器：先关闭劫持，等待后再执行全屏
  async function interceptedRequestFullscreen(options) {
    // 1. 通知 Content Script 关闭劫持
    window.postMessage({ type: 'SPECTRA_PAUSE_FOR_FULLSCREEN' }, '*');
    
    // 2. 设置 DOM 音量 100%
    setAllMediaVolume(1);
    
    // 3. 等待 Capture 完全关闭（关键！）
    await new Promise(r => setTimeout(r, 80));
    
    // 4. 执行原始全屏（此时已不在用户手势上下文，可能失败）
    //    如果失败，用户需要再点一次，但第二次会成功
    return originalRequestFullscreen.call(this, options);
  }

  Element.prototype.requestFullscreen = interceptedRequestFullscreen;
  
  if (originalWebkitRequestFullscreen) {
    Element.prototype.webkitRequestFullscreen = async function(options) {
      window.postMessage({ type: 'SPECTRA_PAUSE_FOR_FULLSCREEN' }, '*');
      setAllMediaVolume(1);
      await new Promise(r => setTimeout(r, 80));
      return originalWebkitRequestFullscreen.call(this, options);
    };
  }
})();
