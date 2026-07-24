/* ============================================================
   HARD SNAP for kct.html / kct-mockups-v2.html.
   Any wheel tick, arrow key, or touch swipe triggers a complete,
   locked jump to the next/previous .snap section - no partial or
   free scrolling. Unlike the unified jonathanlindavis.com homepage,
   these sections are plain document flow (not position:sticky), so
   each section's offsetTop is a reliable, stable jump target.

   Wheel/keydown (desktop only) have no inner-scroll escape valve -
   content there was checked to be short enough per section that it
   isn't needed. Touch (desktop touchscreens AND mobile) DOES have one:
   see currentSectionOverflows() below - mobile viewports are short
   enough that a heavy section (the footer, mainly) can plausibly run
   taller than the screen even though it fits fine on desktop.
   ============================================================ */
(function(){
  var sections = Array.prototype.slice.call(document.querySelectorAll('.snap'));
  if(sections.length < 2) return;

  var LOCK_MS = 350;
  var SWIPE_THRESHOLD = 40;
  var current = 0;
  var locked = false;

  /* Per-page mobile opt-out (2026-07-19, owner request for kct-website.html):
     a page that sets data-mobile-snap="off" on <html> gets NO touch hijack
     below the desktop() width - phones scroll the page natively, as a plain
     clean scroll. Desktop wheel/keydown snapping is unaffected, and pages
     without the attribute (kct.html, kct-mockups-v2.html) keep the original
     everywhere-snap behavior, including touch. The page's own CSS is
     expected to pair this with a mobile-only scroll-snap-type opt-out and
     free-flowing (min-height, not height-capped) sections. */
  var MOBILE_SNAP_OFF = document.documentElement.getAttribute('data-mobile-snap') === 'off';
  function mobileFreeScroll(){ return MOBILE_SNAP_OFF && !desktop(); }

  /* --vh (1% of the ACTUAL visible viewport, per window.innerHeight) -
     CSS's 100vh unit on mobile browsers commonly resolves to the "layout"
     viewport (as if the address bar were permanently collapsed), which
     can be noticeably taller than what's really on screen when the
     address bar is showing. Sections sized with plain 100vh could then
     render a bit taller than the visible screen, leaving a sliver of the
     next section peeking in at the bottom even after landing exactly on
     a hard-snap target. CSS uses calc(var(--vh, 1vh) * 100) instead of
     100vh wherever a section needs to match the screen exactly - see
     .bio/.spotlight/.reel/.reel-side/.reel-center and the header's
     bottom-position calcs in kct.html's <style>. Recomputed on resize
     (covers address-bar show/hide, which fires a resize event) and
     orientation change. */
  function setVH(){
    document.documentElement.style.setProperty('--vh', (window.innerHeight * 0.01) + 'px');
  }
  setVH();
  window.addEventListener('resize', setVH);
  window.addEventListener('orientationchange', setVH);

  function desktop(){ return window.innerWidth >= 760; }

  /* header is position:fixed (see kct.html's header rule), so it no longer
     occupies document flow space - every section's offsetTop is already its
     true target with no special-casing needed. */
  function targetTop(i){
    return sections[i].offsetTop;
  }

  function syncCurrent(){
    var y = window.pageYOffset + 5;
    var idx = 0;
    for(var i=0;i<sections.length;i++){
      if(targetTop(i) <= y) idx = i;
    }
    current = idx;
  }

  /* Header relocates to a different spot per active section: centered on the
     full viewport for the hero, consulting, and footer (all
     vertically-centered content, no photo/copy split), but centered within
     the light "white frame" copy column on About/Spotlight (photo+copy
     split pages) rather than the full viewport, since the copy column
     doesn't span the full width. (The consulting page's awards marquee
     used to be top-anchored there and conflicted with the header - it now
     lives in the footer instead, see kct.html's .footer-marquee, so
     consulting's content is vertically centered like every other section
     and hdr-center is safe again.) The reel page is the one exception to
     "top" entirely: its video now fills the frame all the way to the top
     edge (no header clearance), so the header travels to center-bottom
     there instead of overlapping the video from the top. One position per
     section, indexed to match the .snap array order (hero, about,
     spotlight, reel, consulting, footer). */
  var header = document.querySelector('header');
  var HEADER_POS = ['hdr-center','hdr-frame-r','hdr-frame-l','hdr-center-bottom','hdr-center','hdr-center'];
  function syncHeaderPos(){
    if(!header) return;
    var pos = HEADER_POS[current] || 'hdr-center';
    header.classList.remove('hdr-center','hdr-frame-r','hdr-frame-l','hdr-center-bottom');
    header.classList.add(pos);
  }

  /* Global next-section button: same one-position-per-section-index pattern
     as HEADER_POS above, same section order (hero, about, spotlight, reel,
     consulting, footer). Content only ("Get Started" on the hero, "Next
     Page" elsewhere, hidden on the footer) - see syncSectionButtons() below,
     called from goTo() and the initial bottom-of-file call once everything
     is assigned. */
  var nextBtn = document.querySelector('.next-section-btn');
  /* syncSectionButtons() now only drives the next-section button's per-
     section content - the sound toggle moved to a single fixed position
     (see kct-website.html's .sound-toggle) and no longer needs a per-
     section reposition/hide pass here. */
  function syncSectionButtons(){
    if(nextBtn){
      var isLast = current >= sections.length - 1;
      nextBtn.classList.toggle('nsb-hidden', isLast);
      nextBtn.classList.toggle('nsb-hero', current === 0);
      nextBtn.textContent = current === 0 ? 'Get Started' : 'Next Page';
    }
  }

  function goTo(i){
    if(locked) return;
    if(i < 0 || i >= sections.length) return;
    locked = true;
    current = i;
    window.scrollTo({top: targetTop(i), left:0, behavior:'auto'});
    syncHeaderPos();
    syncSectionButtons();
    setTimeout(function(){ locked = false; }, LOCK_MS);
  }

  /* Desktop escape valve (added 2026-07-19, review fix): the original design
     assumed every section fits a desktop viewport, but on short windows
     (small laptops) a content-heavy section (consulting's work list) can run
     taller than the screen - and a whole-section jump then makes its
     below-the-fold content unreachable by wheel or keyboard. Mirror of the
     touch valve below: if the current section is genuinely taller than the
     viewport (same 100px tolerance, same rationale) AND there is still
     unseen content in the travel direction, let the gesture scroll natively
     inside the section; once its far edge is on screen, the next gesture
     snaps onward as before. */
  function innerRoom(dir){
    var r = sections[current].getBoundingClientRect();
    if(r.height <= window.innerHeight + 100) return false;
    return dir > 0 ? r.bottom > window.innerHeight + 2 : r.top < -2;
  }

  window.addEventListener('wheel', function(e){
    if(!desktop()) return;
    syncCurrent();
    if(innerRoom(e.deltaY > 0 ? 1 : -1)) return;
    e.preventDefault();
    if(locked) return;
    if(e.deltaY > 0) goTo(current+1);
    else if(e.deltaY < 0) goTo(current-1);
  }, {passive:false});

  window.addEventListener('keydown', function(e){
    if(!desktop()) return;
    var tag = (e.target && e.target.tagName || '').toLowerCase();
    if(tag==='input' || tag==='textarea' || tag==='select' || tag==='a') return;
    if(e.key==='ArrowDown' || e.key==='PageDown'){
      syncCurrent();
      if(innerRoom(1)) return;
      e.preventDefault(); goTo(current+1);
    }else if(e.key==='ArrowUp' || e.key==='PageUp'){
      syncCurrent();
      if(innerRoom(-1)) return;
      e.preventDefault(); goTo(current-1);
    }
  });

  /* touch swipes are NOT gated behind desktop() - mobile gets the same
     instant, locked hard-snap jump as desktop's wheel/keydown do, rather
     than falling back to plain native scroll with only the CSS
     scroll-snap-type:proximity as a soft (non-hard) assist.

     Escape valve: mobile viewports are shorter than desktop, and the
     footer in particular stacks a lot of content (heading, social row,
     marquee, legal text, credit button) - tall enough to plausibly
     exceed some phones' viewport height even though it fits fine on
     desktop. If the section the gesture started in is taller than the
     viewport, skip the hard-snap hijack entirely for that gesture and
     let it scroll natively instead, so nothing below the fold becomes
     unreachable. */
  /* tolerance is 100px, not 4px: sections use min-height:100vh, and on
     mobile the CSS vh unit commonly resolves to the browser's "largest"
     viewport (chrome collapsed) while window.innerHeight reflects the
     actually-visible one (chrome showing) - a gap of 50-90px is normal
     and does NOT mean the section has excess content. Too small a
     tolerance here misclassified every section as overflowing, which
     silently disabled hard-snap everywhere instead of just where a
     section genuinely runs taller than the screen. */
  function currentSectionOverflows(){
    var sec = sections[current];
    return sec.scrollHeight > window.innerHeight + 100;
  }

  var touchStartY = null;
  var touchStartOverflow = false;
  window.addEventListener('touchstart', function(e){
    if(mobileFreeScroll()) return;
    touchStartY = e.touches[0].clientY;
    syncCurrent();
    touchStartOverflow = currentSectionOverflows();
  }, {passive:true});

  window.addEventListener('touchmove', function(e){
    if(mobileFreeScroll()) return;
    if(touchStartY===null || touchStartOverflow) return;
    e.preventDefault();
  }, {passive:false});

  window.addEventListener('touchend', function(e){
    if(mobileFreeScroll()) return;
    if(touchStartY===null) return;
    var overflowed = touchStartOverflow;
    var dy = touchStartY - e.changedTouches[0].clientY;
    touchStartY = null;
    if(overflowed){ syncCurrent(); syncHeaderPos(); syncSectionButtons(); return; }
    if(Math.abs(dy) < SWIPE_THRESHOLD || locked) return;
    syncCurrent();
    if(dy > 0) goTo(current+1); else goTo(current-1);
  });

  /* REBUILT 2026-07-19: audio moved off the reel video entirely onto an
     independent, page-wide <audio> element (kct-reel-audio.m4a) that
     plays continuously across every section once unlocked, not just
     while the reel page is in view - so the old section-gating logic
     (checking `current` against the reel section's index before allowing
     an unmute) no longer applies; there's no "wrong section" for this
     audio to be playing in anymore, it's meant to play everywhere.
     Browsers still universally block unmuted autoplay, so it has to
     start muted regardless - soundToggle below (the ONLY way to turn it
     on, a deliberate choice: previously ANY click/tap/keypress anywhere
     on the page silently triggered audio, which is exactly the kind of
     surprise-audio-with-no-visible-source pattern this rebuild's own
     visible, always-on-screen toggle is meant to replace) and the
     next-section button both call playBgAudio(). Unlike the old
     one-time "unlock, then disappear" button, this is a real ongoing
     toggle: soundOn()/soundOff() both update the button's icon, label,
     and aria-pressed state so its own displayed state always matches
     reality, and it can be toggled back off just as easily. */
  var bgAudio = document.getElementById('kct-bg-audio');
  var soundToggle = document.querySelector('.sound-toggle');
  var soundOnIcon = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M4 9v6h4l5 5V4L8 9H4z"/></svg><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" style="margin-left:-4px"><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
  var soundOffIcon = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M4 9v6h4l5 5V4L8 9H4z"/></svg><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="16" y1="8" x2="22" y2="14"/><line x1="22" y1="8" x2="16" y2="14"/></svg>';
  function paintSoundToggle(on){
    if(!soundToggle) return;
    soundToggle.querySelector('.st-icon').innerHTML = on ? soundOnIcon : soundOffIcon;
    soundToggle.querySelector('.st-label').textContent = on ? 'Sound on' : 'Sound off';
    soundToggle.setAttribute('aria-label', on ? 'Turn off sound' : 'Turn on sound');
    soundToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  function playBgAudio(){
    if(!bgAudio) return;
    bgAudio.muted = false;
    bgAudio.play().catch(function(){ /* blocked outside a real gesture - toggle stays clickable to retry */ });
    paintSoundToggle(true);
  }
  function pauseBgAudio(){
    if(!bgAudio) return;
    bgAudio.pause();
    paintSoundToggle(false);
  }
  if(soundToggle){
    soundToggle.addEventListener('click', function(){
      if(!bgAudio) return;
      if(bgAudio.paused || bgAudio.muted) playBgAudio();
      else pauseBgAudio();
    });
  }

  /* Global next-section button click: advance to the next section AND
     unlock/play the page-wide audio - every click of this button, on
     any section, is a deliberate early unlock, per the design this
     whole file's 2026-07-19 changes build toward. */
  if(nextBtn){
    nextBtn.addEventListener('click', function(){
      playBgAudio();
      goTo(current+1);
    });
  }

  /* consulting page CTA: no URL of its own - instead it flashes the
     header's Contact link (burgundy, ~5s) to point at where to actually
     reach out, rather than jumping anywhere itself. */
  var consultCta = document.getElementById('kct-consult-cta');
  var hdrContact = document.getElementById('kct-hdr-contact');
  if(consultCta && hdrContact){
    consultCta.addEventListener('click', function(){
      hdrContact.classList.remove('kct-flash');
      void hdrContact.offsetWidth;
      hdrContact.classList.add('kct-flash');
      setTimeout(function(){ hdrContact.classList.remove('kct-flash'); }, 5000);
    });
  }

  /* Initial sync, kept at the true end of the file (moved here from right
     after the touch handlers, near the top) so it runs after nextBtn and
     every other var referenced by the sync functions is assigned. */
  syncCurrent();
  syncHeaderPos();
  syncSectionButtons();
})();
