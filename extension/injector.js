(function() {
  const originalCreateElement = document.createElement;
  const originalCreateElementNS = document.createElementNS;
  // 备份原生的 Audio 构造函数
  const OriginalAudio = window.Audio;

  // 1. 劫持 document.createElement
  // 目的：确保通过 JS 创建的 <video>/<audio> 元素带有 crossorigin="anonymous" 属性
  // 这对于 Web Audio API 的 createMediaElementSource 能够处理跨域资源至关重要
  document.createElement = function(tagName, options) {
    const element = originalCreateElement.call(this, tagName, options);
    if (tagName && (tagName.toLowerCase() === 'video' || tagName.toLowerCase() === 'audio')) {
      element.setAttribute('crossorigin', 'anonymous');
    }
    return element;
  };

  // 2. 劫持 document.createElementNS (用于 XML/XHTML 命名空间)
  document.createElementNS = function(ns, tagName, options) {
    const element = originalCreateElementNS.call(this, ns, tagName, options);
    if (tagName && (tagName.toLowerCase() === 'video' || tagName.toLowerCase() === 'audio')) {
      element.setAttribute('crossorigin', 'anonymous');
    }
    return element;
  };

  // 3. 劫持 new Audio() 构造函数
  // 很多网站 (如很多 H5 游戏或音乐站) 使用 new Audio() 来播放声音
  // 必须确保这些实例也具备跨域访问能力
  window.Audio = function(src) {
    const element = new OriginalAudio(src);
    element.setAttribute('crossorigin', 'anonymous');
    return element;
  };
  window.Audio.prototype = OriginalAudio.prototype;
})();