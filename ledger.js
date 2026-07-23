/* ============================================================
   Fixed, desktop-only section ledger. One-way consumer of section
   position via a single IntersectionObserver -- never calls
   scrollIntoView, never touches history, never intercepts anchor
   clicks, so it has no dependency on stack-scroll.js (retired Stage 5).
   Loaded only by the page that carries <html class="stack-page">.
   ============================================================ */
(function(){
  var html = document.documentElement;
  if(!html.classList.contains('stack-page')) return;

  var mq = window.matchMedia('(min-width:900px)');
  var sections = Array.prototype.slice.call(document.querySelectorAll('.stack-item'));
  if(!sections.length) return;

  var state = {};
  var io = null;

  function paint(id){
    document.querySelectorAll('.ledger-tick').forEach(function(t){
      t.classList.toggle('is-active', t.dataset.id === id);
    });
    var nameEl = document.querySelector('.ledger-name');
    if(nameEl) nameEl.textContent = id;
  }

  function onIntersect(entries){
    entries.forEach(function(e){ state[e.target.id] = e.isIntersecting; });
    /* Tie-break kept for structural safety under normal document flow:
       take the highest DOM-order id currently intersecting the
       -45%/-45% band. */
    var activeId = null;
    sections.forEach(function(s){ if(state[s.id]) activeId = s.id; });
    if(activeId) paint(activeId);
  }

  function setup(){
    if(io) return;
    io = new IntersectionObserver(onIntersect, {threshold: 0, rootMargin: '-45% 0px -45% 0px'});
    sections.forEach(function(s){ io.observe(s); });
  }
  function teardown(){
    if(!io) return;
    io.disconnect();
    io = null;
  }
  function sync(){ if(mq.matches) setup(); else teardown(); }
  mq.addEventListener('change', sync);
  sync();
})();
