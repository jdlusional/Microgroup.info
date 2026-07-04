/* ============================================================
   HARD SNAP for the unified single-page stack (index.html only).
   Loaded only by the page that carries <html class="stack-page">.
   Any wheel tick, arrow key, or touch swipe triggers a complete,
   locked jump to the next/previous .stack-item — no partial or
   free scrolling between sections on desktop. Mobile keeps native
   scrolling (see the .stack-item mobile reset in style.css).
   ============================================================ */
(function(){
  var html = document.documentElement;
  if(!html.classList.contains('stack-page')) return;

  var sections = Array.prototype.slice.call(document.querySelectorAll('.stack-item'));
  if(sections.length < 2) return;

  var barH = parseInt(getComputedStyle(html).getPropertyValue('--bar-h'), 10) || 72;
  /* Eased slide (behavior:'smooth'), not an instant cut — still a locked,
     complete jump to the next/previous section, just animated rather than
     an abrupt cut. LOCK_MS is only a SAFETY-NET timeout for browsers where
     'scrollend' never fires; the real unlock happens on 'scrollend' itself
     (see below), because a fixed short timeout would release the lock
     WHILE the smooth-scroll animation was still in flight. */
  var LOCK_MS = 900;
  var SWIPE_THRESHOLD = 40;

  var current = 0;
  var locked = false;
  var lockTimer = null;

  function unlock(){
    locked = false;
    if(lockTimer){ clearTimeout(lockTimer); lockTimer = null; }
  }

  function desktop(){ return window.innerWidth >= 900; }

  /* Every .stack-item shares the exact same CSS height
     (calc(100vh - var(--bar-h))), so each section's scroll target is just
     its index times that shared height — pure arithmetic from
     window.innerHeight, not a live offsetTop read. offsetTop looked like
     the more robust choice (a sticky element's static flow position,
     independent of scroll state), but in practice a section that has
     already been scrolled past and is sitting stuck/pinned reports its
     offsetTop as roughly "wherever the page currently is," not its true
     original position — which broke every attempt to return to an
     earlier section while leaving forward navigation unaffected (since a
     not-yet-reached section's offsetTop is still accurate). */
  function sectionHeight(){
    return window.innerHeight - barH;
  }
  function sectionTop(i){
    return i * sectionHeight();
  }

  function syncCurrent(){
    var y = window.pageYOffset + barH + 5;
    var idx = 0;
    for(var i=0;i<sections.length;i++){
      if(sectionTop(i) <= y) idx = i;
    }
    current = idx;
  }

  function goTo(i){
    if(locked) return;
    if(i < 0 || i >= sections.length) return;
    locked = true;
    current = i;
    window.scrollTo({top: sectionTop(i), left:0, behavior:'smooth'});
    lockTimer = setTimeout(unlock, LOCK_MS);
  }

  /* Primary unlock signal: the browser telling us the smooth-scroll actually
     finished, not a guessed timeout. LOCK_MS above only covers browsers/
     cases where 'scrollend' never fires. */
  window.addEventListener('scrollend', function(){
    if(locked) unlock();
  });

  /* Only the section(s) explicitly marked .stack-scroll (Contact/Newsletter)
     get the "let native inner-scroll happen first" escape valve. Checking
     plain .inner overflow (scrollHeight > clientHeight) isn't a reliable
     signal on its own — most sections' .inner is overflow:visible, so it can
     read as "has more content than the box" without being scrollable at all,
     which silently swallowed wheel/touch input on those sections instead of
     hijacking it (the "won't scroll up" / "snap stops between sections" bug). */
  function scrollableInner(target){
    var el = target;
    while(el && el !== document.body){
      if(el.classList && el.classList.contains('inner')){
        return el.closest('.stack-scroll') ? el : null;
      }
      el = el.parentElement;
    }
    return null;
  }
  function innerCanScroll(el, dy){
    if(!el || el.scrollHeight <= el.clientHeight) return false;
    if(dy > 0) return el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    return el.scrollTop > 1;
  }

  window.addEventListener('wheel', function(e){
    if(!desktop()) return;
    var inner = scrollableInner(e.target);
    if(innerCanScroll(inner, e.deltaY)) return;
    e.preventDefault();
    if(locked) return;
    syncCurrent();
    if(e.deltaY > 0) goTo(current+1);
    else if(e.deltaY < 0) goTo(current-1);
  }, {passive:false});

  window.addEventListener('keydown', function(e){
    if(!desktop()) return;
    var tag = (e.target && e.target.tagName || '').toLowerCase();
    if(tag==='input' || tag==='textarea' || tag==='select') return;
    if(e.key==='ArrowDown' || e.key==='PageDown'){
      e.preventDefault(); syncCurrent(); goTo(current+1);
    }else if(e.key==='ArrowUp' || e.key==='PageUp'){
      e.preventDefault(); syncCurrent(); goTo(current-1);
    }
  });

  var touchStartY = null, touchInner = null;
  window.addEventListener('touchstart', function(e){
    if(!desktop()) return;
    touchStartY = e.touches[0].clientY;
    touchInner = scrollableInner(e.target);
  }, {passive:true});

  window.addEventListener('touchmove', function(e){
    if(!desktop() || touchStartY===null) return;
    var dy = touchStartY - e.touches[0].clientY;
    if(innerCanScroll(touchInner, dy)) return;
    e.preventDefault();
  }, {passive:false});

  window.addEventListener('touchend', function(e){
    if(!desktop() || touchStartY===null) return;
    var dy = touchStartY - e.changedTouches[0].clientY;
    touchStartY = null;
    if(Math.abs(dy) < SWIPE_THRESHOLD) return;
    if(innerCanScroll(touchInner, dy)) return;
    if(locked) return;
    syncCurrent();
    if(dy > 0) goTo(current+1); else goTo(current-1);
  });

  /* Nav/footer/"Go to X" links are plain #anchor hrefs. Letting the browser
     do its own native anchor-jump against a STICKY, overflow:hidden,
     z-index-stacked section is unreliable — sticky elements can already
     read as "in view" from the browser's own geometry check, so nothing
     visibly moves. Every #anchor click to a known section is intercepted
     here and routed through the same goTo() used by wheel/keyboard/touch,
     which is the one proven-reliable way to move between sections on this
     page. history.replaceState keeps the URL hash in sync WITHOUT letting
     the browser attempt its own native scroll for that hash change. */
  var sectionIndexById = {};
  sections.forEach(function(s, i){ if(s.id) sectionIndexById[s.id] = i; });
  /* Some sections (Get in Touch) carry an extra decoy anchor inside them
     (e.g. #newsletter inside the #contact section) purely so a link can
     pick which of two panels shows by default, without that anchor being
     a section of its own — map every id found anywhere inside a section
     to that section's index too, not just each section's own id. */
  sections.forEach(function(s, i){
    var inner = s.querySelectorAll('[id]');
    for(var j=0;j<inner.length;j++){
      if(!sectionIndexById.hasOwnProperty(inner[j].id)) sectionIndexById[inner[j].id] = i;
    }
  });

  function goToId(id){
    if(!sectionIndexById.hasOwnProperty(id)) return false;
    goTo(sectionIndexById[id]);
    if(window.history && history.replaceState) history.replaceState(null, '', '#'+id);
    return true;
  }

  document.addEventListener('click', function(e){
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if(!a) return;
    var id = a.getAttribute('href').slice(1);
    if(goToId(id)) e.preventDefault();
  });

  /* Covers direct/external navigation to a hash (e.g. a bookmark, or one of
     the site's own _redirects 301s landing on /#about) — same unreliable-
     native-jump problem, same fix: route it through goTo() instead. */
  window.addEventListener('hashchange', function(){
    var id = location.hash.slice(1);
    if(!goToId(id)) setTimeout(syncCurrent, 50);
  });

  if(location.hash){
    goToId(location.hash.slice(1));
  }
  syncCurrent();
})();
