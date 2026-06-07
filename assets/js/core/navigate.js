(function () {
  if (!document.startViewTransition) return;

  // The path we're currently showing. Hash-only history changes (the sticky
  // #photo / #audio / #video nav strip, and back/forward across those) keep this
  // value, so popstate can tell a same-page scroll from a real page change.
  var currentPath = location.pathname;

  function swap(doc) {
    document.title = doc.title;

    // Swap the whole site-mark (kicker + title + byline + sub) so per-page
    // headers ("About", "Patch Notes", "Analyser") follow the navigation. The
    // fresh title has no letter-spans yet; app.js's setupHeaderFx() re-binds the
    // hover/sweep effect when it handles the anr:navigate event below.
    var oldMark = document.querySelector('.site-mark');
    var newMark = doc.querySelector('.site-mark');
    if (oldMark && newMark) oldMark.replaceWith(newMark);

    var oldNav = document.querySelector('.site-nav');
    var newNav = doc.querySelector('.site-nav');
    if (oldNav && newNav) {
      oldNav.replaceWith(newNav);
    } else if (oldNav && !newNav) {
      oldNav.remove();
    } else if (!oldNav && newNav) {
      var header = document.querySelector('.site-header');
      if (header) header.after(newNav);
    }

    var oldMain = document.querySelector('.site-main');
    var newMain = doc.querySelector('.site-main');
    if (oldMain && newMain) oldMain.replaceWith(newMain);

    var oldFooter = document.querySelector('.site-footer');
    var newFooter = doc.querySelector('.site-footer');
    if (oldFooter && newFooter) {
      oldFooter.replaceWith(newFooter);
    } else if (oldFooter && !newFooter) {
      oldFooter.remove();
    } else if (!oldFooter && newFooter) {
      var main = document.querySelector('.site-main');
      if (main) main.after(newFooter);
    }
  }

  function navigateTo(url, push) {
    fetch(url)
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        document.startViewTransition(function () {
          swap(doc);
          currentPath = new URL(url).pathname;
          if (push) history.pushState(null, '', url);
          window.dispatchEvent(new Event('anr:navigate'));
        });
      })
      .catch(function () {
        if (push) location.href = url;
        else location.reload();
      });
  }

  document.addEventListener('click', function (e) {
    var link = e.target.closest('a[href]');
    if (!link) return;
    var href = link.getAttribute('href');
    if (!href) return;
    if (link.target === '_blank' || link.hasAttribute('download')) return;
    if (href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto:')) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;

    // Canonical URLs are clean (no .html): /about, /patch, / . Normalise any
    // stray .html link to that form so the address bar and history stay clean
    // and a reload hits the same URL the server serves.
    var u = new URL(href, location.href);
    u.pathname = u.pathname.replace(/\/index\.html(?=$)/, '/').replace(/\.html(?=$)/, '');
    var url = u.href;
    if (url === location.href) return;

    e.preventDefault();
    navigateTo(url, true);
  });

  window.addEventListener('popstate', function () {
    // A hash-only move within the same document (the #photo/#audio/#video nav
    // strip, or going back/forward across those jumps) must stay a native scroll.
    // Re-fetching and swapping the page here would tear down the live analysis
    // results, players and blob URLs. Only swap when the path itself changed.
    if (location.pathname === currentPath) return;
    navigateTo(location.href, false);
  });
})();
