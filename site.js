document.addEventListener('click',function(e){
  var t=e.target.closest('.nav-toggle');
  if(t){var r=document.querySelector('.nav-right');if(r)r.classList.toggle('open');return;}
});
document.addEventListener('DOMContentLoaded',function(){
  var y=document.getElementById('yr');if(y)y.textContent=new Date().getFullYear();
});
