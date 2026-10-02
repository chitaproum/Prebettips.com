/* PreBetTips advertising — edit only the CONFIG below.
 * Use only trusted provider code. Tracking/consent obligations are yours.
 * AdSense requires your approved publisher ID and real ad-unit slot IDs.
 */
(function () {
  'use strict';
  var CONFIG = {
    enabled: true,
    showPlaceholders: true, // false hides placements without a configured ad
    // Set false if ads must wait for consent; call PreBetAds.setConsent(true)
    // from your consent manager only after the required permission is granted.
    consentGranted: true,
    adsenseClient: '', // e.g. ca-pub-YOUR_PUBLISHER_ID
    slots: {
      top:     { enabled: true, type: 'placeholder' },
      below:   { enabled: true, type: 'placeholder' },
      inTable: { enabled: true, type: 'placeholder' },
      sidebar: { enabled: true, type: 'placeholder' },
      footer:  { enabled: true, type: 'placeholder' },
      anchor:  { enabled: true, type: 'placeholder' }
    }
  };

  /* REPLACE a placement above with one of these:
   * Image banner:
   * top: { enabled: true, type: 'image', image: 'images/banner.jpg',
   *        href: 'https://YOUR-SPONSOR.example', alt: 'Sponsor name' }
   * HTML / trusted provider snippet (use backticks for multiline code):
   * sidebar: { enabled: true, type: 'html', html: `<a href="https://example.com">Sponsor</a>` }
   * AdSense (set adsenseClient above; do not paste its loader separately):
   * top: { enabled: true, type: 'adsense', slot: 'YOUR_AD_UNIT_ID', format: 'auto' }
   * Disable a placement:
   * anchor: { enabled: false }
   * For AdSense, prefer top/below/sidebar/footer. Repeated table units can
   * create excessive ad density. The site's custom sticky anchor is NOT
   * Google's managed anchor format; do not put AdSense inside it.
   */

  var selectors = {
    top: '.ad-leaderboard', below: '.ad-inline:not([data-ad-placement])',
    inTable: 'tr.ad-row .ad-slot', sidebar: '.ad-mpu',
    footer: '.ad-footer', anchor: '#anchorAd'
  };
  var sizes = { top: '728×90', below: '728×90', inTable: '728×90',
    sidebar: '300×250', footer: '970×90', anchor: '320×50' };
  var mounted = new WeakSet();
  var observer;
  var adsensePromise;
  var anchorDismissed = false;

  var style = document.createElement('style');
  style.textContent = '.ad-slot[data-ad-disabled="true"]{display:none!important}' +
    'tr.ad-row[data-ad-disabled="true"]{display:none!important}' +
    '.ad-managed-content{width:100%;max-width:100%;min-width:0}' +
    '.ad-managed-content img{display:block;max-width:100%;max-height:100%;height:auto;margin:auto}' +
    '.ad-managed-image,.ad-managed-image a{height:100%;display:flex;align-items:center;justify-content:center}' +
    '.ad-managed-content iframe{max-width:100%;border:0}' +
    '.ad-slot[data-ad-kind="html"],.ad-slot[data-ad-kind="adsense"]{height:auto;min-height:90px}' +
    '.ad-mpu[data-ad-kind="html"],.ad-mpu[data-ad-kind="adsense"]{min-height:250px}' +
    '.ad-anchor[data-ad-kind="html"]{height:54px;min-height:54px}';
  document.head.appendChild(style);

  function safeUrl(value) {
    var url = new URL(value, document.baseURI);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Ad URLs must use HTTP or HTTPS.');
    }
    return url.href;
  }
  function setHidden(el, hidden) {
    el.dataset.adDisabled = String(hidden);
    var row = el.closest('tr.ad-row');
    if (row) row.dataset.adDisabled = String(hidden);
    if (el.id === 'anchorAd') {
      document.body.classList.toggle('anchor-hidden', hidden || anchorDismissed);
    }
  }
  function clearSlot(el) {
    Array.from(el.children).forEach(function (child) {
      if (!child.classList.contains('ad-close')) child.remove();
    });
  }
  function showPlaceholder(el, name, message) {
    clearSlot(el);
    var body = document.createElement('span');
    body.className = 'ad-body';
    body.textContent = message || 'Your banner here';
    var size = document.createElement('span');
    size.className = 'ad-size'; size.textContent = sizes[name];
    body.appendChild(size); el.prepend(body);
  }
  function loadAdSense() {
    if (adsensePromise) return adsensePromise;
    adsensePromise = new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[src*="pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"]');
      if (existing) {
        // The AdSense queue supports pushes while an existing loader is pending.
        resolve(); return;
      }
      var script = document.createElement('script');
      script.async = true; script.crossOrigin = 'anonymous';
      script.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(CONFIG.adsenseClient);
      script.onload = resolve;
      script.onerror = function () { reject(new Error('AdSense loader failed or was blocked.')); };
      document.head.appendChild(script);
    });
    return adsensePromise;
  }
  async function activateScripts(container) {
    // HTML inserted through innerHTML does not execute scripts. Recreate them
    // in document order. document.write-based legacy embeds are not supported.
    for (var old of Array.from(container.querySelectorAll('script'))) {
      var script = document.createElement('script');
      Array.from(old.attributes).forEach(function (a) { script.setAttribute(a.name, a.value); });
      script.textContent = old.textContent;
      if (old.src) {
        script.src = safeUrl(old.getAttribute('src'));
        await new Promise(function (resolve, reject) {
          script.onload = resolve;
          script.onerror = function () { reject(new Error('Advertising script failed to load.')); };
          old.replaceWith(script);
        });
      } else { old.replaceWith(script); }
    }
  }
  function mount(el, name) {
    if (mounted.has(el)) return;
    mounted.add(el);
    var cfg = CONFIG.slots[name] || { enabled: false };
    var type = cfg.type || 'placeholder';
    el.dataset.adPlacement = name;
    el.dataset.adKind = type;
    var disabled = !CONFIG.enabled || cfg.enabled === false ||
      (!CONFIG.showPlaceholders && type === 'placeholder') ||
      (name === 'anchor' && anchorDismissed);
    setHidden(el, disabled);
    if (disabled) return;
    if (name === 'anchor') {
      var close = el.querySelector('.ad-close');
      if (close && !close.dataset.adBound) {
        close.dataset.adBound = 'true';
        close.addEventListener('click', function () {
          anchorDismissed = true; setHidden(el, true);
        });
      }
    }
    if (!CONFIG.consentGranted && type !== 'placeholder') {
      if (CONFIG.showPlaceholders) showPlaceholder(el, name, 'Advertisement');
      else setHidden(el, true);
      return;
    }
    if (type === 'placeholder') { showPlaceholder(el, name); return; }
    clearSlot(el);
    var content = document.createElement('div');
    content.className = 'ad-managed-content'; el.prepend(content);
    try {
      if (type === 'image') {
        content.classList.add('ad-managed-image');
        var image = document.createElement('img');
        image.src = safeUrl(cfg.image); image.alt = cfg.alt || 'Advertisement';
        image.loading = 'lazy';
        if (cfg.href) {
          var link = document.createElement('a'); link.href = safeUrl(cfg.href);
          link.target = '_blank'; link.rel = 'sponsored nofollow noopener noreferrer';
          link.appendChild(image); content.appendChild(link);
        } else content.appendChild(image);
      } else if (type === 'html') {
        if (!cfg.html) throw new Error('Missing HTML embed code.');
        content.innerHTML = cfg.html;
        activateScripts(content).catch(function (e) { console.warn('[PreBetAds]', name, e.message); });
      } else if (type === 'adsense') {
        if (name === 'anchor') throw new Error('Use Google-managed anchor ads, not this custom sticky slot.');
        if (!/^ca-pub-\d+$/.test(CONFIG.adsenseClient) || !/^\d+$/.test(String(cfg.slot || ''))) {
          throw new Error('Enter your real AdSense publisher ID and ad-unit ID.');
        }
        var ins = document.createElement('ins'); ins.className = 'adsbygoogle';
        ins.style.display = 'block';
        ins.setAttribute('data-ad-client', CONFIG.adsenseClient);
        ins.setAttribute('data-ad-slot', cfg.slot);
        ins.setAttribute('data-ad-format', cfg.format || 'auto');
        ins.setAttribute('data-full-width-responsive', 'true');
        content.appendChild(ins);
        var start = function () {
          loadAdSense().then(function () {
            if (!CONFIG.enabled || !CONFIG.consentGranted || !ins.isConnected) return;
            (window.adsbygoogle = window.adsbygoogle || []).push({});
          }).catch(function (e) { console.warn('[PreBetAds]', e.message); });
        };
        // Wait until visible, including placements inside hidden tabs.
        if ('IntersectionObserver' in window) {
          var visibility = new IntersectionObserver(function (entries) {
            if (entries.some(function (entry) { return entry.isIntersecting; })) {
              visibility.disconnect(); start();
            }
          });
          visibility.observe(ins);
          ins.style.minHeight = name === 'sidebar' ? '250px' : '90px';
        } else start();
      } else throw new Error('Unknown advertising type: ' + type);
    } catch (e) {
      console.warn('[PreBetAds]', name, e.message);
      if (CONFIG.showPlaceholders) showPlaceholder(el, name, 'Configure this ad in ads.js');
      else setHidden(el, true);
    }
  }
  function scan() {
    // Explicit names cover freshly generated sidebar/table placements.
    document.querySelectorAll('[data-ad-placement]').forEach(function (el) {
      mount(el, el.dataset.adPlacement);
    });
    Object.keys(selectors).forEach(function (name) {
      document.querySelectorAll(selectors[name]).forEach(function (el) {
        mount(el, el.dataset.adPlacement || name);
      });
    });
  }
  function refresh() { mounted = new WeakSet(); scan(); }
  window.PreBetAds = {
    refresh: refresh,
    setConsent: function (granted) { CONFIG.consentGranted = Boolean(granted); refresh(); },
    setEnabled: function (enabled) { CONFIG.enabled = Boolean(enabled); refresh(); }
  };
  function init() {
    scan();
    observer = new MutationObserver(function (changes) {
      if (changes.some(function (change) {
        return Array.from(change.addedNodes).some(function (node) {
          return node.nodeType === 1 && (node.matches('.ad-slot') || node.querySelector('.ad-slot'));
        });
      })) scan();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
