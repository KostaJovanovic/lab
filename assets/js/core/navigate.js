(function () {
  if (!document.startViewTransition) return;

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

    window.scrollTo(0, 0);
  }

  function navigateTo(url, push) {
    fetch(url)
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        document.startViewTransition(function () {
          swap(doc);
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

    var url = new URL(href, location.href).href;
    url = url.replace(/\/index\.html(?=[\?#]|$)/, '/');
    if (url === location.href) return;

    e.preventDefault();
    navigateTo(url, true);
  });

  window.addEventListener('popstate', function () {
    navigateTo(location.href, false);
  });
})();
