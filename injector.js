(function() {
  const originalCreateElement = document.createElement;
  const originalCreateElementNS = document.createElementNS;

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
})();