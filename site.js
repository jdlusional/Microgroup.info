document.documentElement.classList.add('snap');
document.addEventListener('click',function(e){
  var t=e.target.closest('.nav-toggle');
  if(t){var r=document.querySelector('.nav-right');if(r)r.classList.toggle('open');return;}
  var c=e.target.closest('.chevron');
  if(c){
    var panels=Array.prototype.slice.call(document.querySelectorAll('.panel,.footer-panel'));
    var cur=c.closest('.panel');
    var i=panels.indexOf(cur);
    if(i>-1&&i<panels.length-1){panels[i+1].scrollIntoView({behavior:'smooth',block:'start'});}
  }
});
document.addEventListener('DOMContentLoaded',function(){
  var y=document.getElementById('yr');if(y)y.textContent=new Date().getFullYear();
});
