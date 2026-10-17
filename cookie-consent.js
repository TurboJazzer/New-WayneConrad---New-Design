/**
 * Wayne Conrad Advisory — site-wide cookie consent.
 * Include this ONE file on every page, right before </body>:
 *   <script src="/cookie-consent.js" defer></script>
 *
 * What it does:
 * - Injects a small consent card (bottom-left) styled to match the site.
 * - Google Analytics (GA4) and Google Tag Manager only load AFTER the
 *   visitor clicks Accept. Nothing is set on Decline or before a choice
 *   is made.
 * - Remembers the choice in localStorage (wc_cookie_consent), so it only
 *   asks once per browser.
 * - Exposes window.showCookieBanner() so a page can add a "Manage Cookies"
 *   link/button anywhere (footer, privacy page, etc.) that reopens it.
 *
 * To change the GA/GTM IDs, edit GA_ID and GTM_ID below — one place,
 * applies to every page that includes this script.
 *
 * CLS FIX HISTORY (for whoever reads this next): three earlier versions
 * of this file all tried different ways of toggling the banner's
 * visibility (display, then opacity/visibility, then deciding state
 * before creation to avoid any post-insertion mutation). All three
 * measured identically on Lighthouse retest, which ruled out visibility
 * toggling as the actual cause. An isolation test (removing this script
 * entirely) confirmed the banner genuinely is the CLS source, so the
 * remaining variable was the box's SIZE, not its visibility. This
 * version switches the banner off the site's custom web font (Inter)
 * onto system fonts only, and drops the CSS transition property. The
 * working theory: Inter loads asynchronously, and if it finished
 * loading after this banner's text first rendered in a fallback font,
 * the font swap would reflow the text and resize the box (height was
 * always content-driven, never fixed), shifting the box's top edge
 * since it's anchored by bottom. System fonts have no load delay, so
 * there is no swap event left to trigger a resize.
 */
(function () {
  var GA_ID = 'G-4B6HCGLY1N';
  var GTM_ID = 'GTM-N8JWZVGH';
  var CONSENT_KEY = 'wc_cookie_consent';

  // ---- Analytics loader (only ever called after consent) ----
  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }

  function loadAnalytics() {
    if (window.__analyticsLoaded) return;
    window.__analyticsLoaded = true;

    var gtagScript = document.createElement('script');
    gtagScript.async = true;
    gtagScript.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(gtagScript);

    gtag('js', new Date());
    gtag('config', GA_ID);

    (function (w, d, s, l, i) {
      w[l] = w[l] || [];
      w[l].push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
      var f = d.getElementsByTagName(s)[0],
        j = d.createElement(s),
        dl = l != 'dataLayer' ? '&l=' + l : '';
      j.async = true;
      j.src = 'https://www.googletagmanager.com/gtm.js?id=' + i + dl;
      f.parentNode.insertBefore(j, f);
    })(window, document, 'script', 'dataLayer', GTM_ID);
  }

  // ---- Styles (injected once) ----
  // Explicit height (not auto) and no transition property: the box's
  // rect is now fully fixed by CSS, it cannot resize after first paint
  // for any reason (font swap, content reflow, or otherwise). System
  // font stack only, no custom web font dependency for this component,
  // removing any possible font-swap reflow risk entirely.
  var style = document.createElement('style');
  style.textContent =
    '#cookie-consent{position:fixed;left:20px;bottom:20px;z-index:9999;width:320px;' +
    'max-width:calc(100% - 40px);background:#fff;border:1px solid #e2e8f0;' +
    'border-radius:12px;padding:20px;box-shadow:0 12px 32px rgba(15,23,42,0.18);' +
    "font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
    'opacity:1;visibility:visible;}' +
    '#cookie-consent.hidden{opacity:0;visibility:hidden;pointer-events:none;}' +
    '#cookie-consent-title{font-size:14px;font-weight:700;color:#0f172a;margin:0 0 8px;}' +
    '#cookie-consent-text{font-size:13px;line-height:1.55;color:#6b7280;margin:0 0 16px;}' +
    '#cookie-consent-text a{color:#2d5be3;text-decoration:underline;display:inline-block;padding:12px 2px;margin:-12px 0;}' +
    '#cookie-consent-buttons{display:flex;gap:8px;}' +
    '#cookie-consent-buttons button{font-size:13px;font-weight:600;padding:9px 14px;' +
    'border-radius:6px;border:none;cursor:pointer;flex:1;transition:background .2s,border-color .2s;}' +
    '#cookie-accept{background:#2d5be3;color:#fff;}' +
    '#cookie-accept:hover{background:#1e4bcf;}' +
    '#cookie-decline{background:#f8fafc;color:#0f172a;border:1px solid #e2e8f0 !important;}' +
    '#cookie-decline:hover{background:#edf1f5;}' +
    '@media (max-width:480px){#cookie-consent{left:12px;right:12px;bottom:12px;width:auto;}}';
  document.head.appendChild(style);

  // ---- Markup (injected once, on DOM ready) ----
  function injectBanner() {
    var consent = localStorage.getItem(CONSENT_KEY);
    var startsVisible = !consent;

    var el = document.createElement('div');
    el.id = 'cookie-consent';
    el.className = startsVisible ? '' : 'hidden';
    el.style.cssText = 'position:fixed;left:20px;bottom:20px;z-index:9999;' +
      (startsVisible ? '' : 'opacity:0;visibility:hidden;pointer-events:none;');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Cookie consent');
    el.innerHTML =
      '<p id="cookie-consent-title">Cookies</p>' +
      '<p id="cookie-consent-text">This site uses Google Analytics and Google Tag Manager to understand how visitors use the pages. No cookies are set until you accept. See the <a href="/privacy.html">privacy policy</a> for details.</p>' +
      '<div id="cookie-consent-buttons">' +
      '<button id="cookie-decline">Decline</button>' +
      '<button id="cookie-accept">Accept</button>' +
      '</div>';
    document.body.appendChild(el);

    document.getElementById('cookie-accept').addEventListener('click', acceptCookies);
    document.getElementById('cookie-decline').addEventListener('click', declineCookies);

    if (consent === 'granted') {
      loadAnalytics();
    }
  }

  function acceptCookies() {
    localStorage.setItem(CONSENT_KEY, 'granted');
    document.getElementById('cookie-consent').classList.add('hidden');
    loadAnalytics();
  }

  function declineCookies() {
    localStorage.setItem(CONSENT_KEY, 'denied');
    document.getElementById('cookie-consent').classList.add('hidden');
  }

  window.showCookieBanner = function () {
    var el = document.getElementById('cookie-consent');
    if (el) {
      el.classList.remove('hidden');
      el.style.opacity = '';
      el.style.visibility = '';
      el.style.pointerEvents = '';
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectBanner);
  } else {
    injectBanner();
  }
})();
