document.addEventListener('click',function(e){
  var t=e.target.closest('.nav-toggle');
  if(t){var r=document.querySelector('.nav-right');if(r)r.classList.toggle('open');return;}
});
document.addEventListener('DOMContentLoaded',function(){
  var y=document.getElementById('yr');if(y)y.textContent=new Date().getFullYear();
});

/* ============================================================
   GET IN TOUCH FORM -- ported from jonathanlindavis.com's site.js
   so both sites' contact forms share one request contract. Posts
   to a Cloudflare Pages Function at /api/contact.
   Required: first_name, last_name, email, phone, message. Optional:
   organization, purpose, referral.
   ============================================================ */
(function(){
  var form=document.getElementById('contact-form');
  if(!form)return;

  var ENDPOINT='/api/contact';
  var status=document.getElementById('contact-status');
  var submit=document.getElementById('contact-submit');
  var emailRe=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function setStatus(msg,kind){
    status.textContent=msg;
    status.className='form-status'+(kind?' '+kind:'');
  }
  function clearInvalid(){
    var f=form.querySelectorAll('.invalid');
    for(var i=0;i<f.length;i++)f[i].classList.remove('invalid');
  }
  function markInvalid(el){el.classList.add('invalid');}

  form.addEventListener('submit',function(e){
    e.preventDefault();
    clearInvalid();
    setStatus('','');

    var data={
      first_name:form.first_name.value.trim(),
      last_name:form.last_name.value.trim(),
      email:form.email.value.trim(),
      phone:form.phone.value.trim(),
      organization:form.organization.value.trim(),
      purpose:form.purpose.value.trim(),
      referral:form.referral.value.trim(),
      message:form.message.value.trim(),
      company_website:form.company_website.value.trim()
    };

    var firstBad=null;
    if(!data.first_name){markInvalid(form.first_name);firstBad=firstBad||form.first_name;}
    if(!data.last_name){markInvalid(form.last_name);firstBad=firstBad||form.last_name;}
    if(!emailRe.test(data.email)){markInvalid(form.email);firstBad=firstBad||form.email;}
    if(!data.phone){markInvalid(form.phone);firstBad=firstBad||form.phone;}
    if(!data.message){markInvalid(form.message);firstBad=firstBad||form.message;}

    if(firstBad){
      setStatus('Please check the highlighted fields.','err');
      if(firstBad.focus)firstBad.focus();
      return;
    }

    submit.disabled=true;
    var original=submit.textContent;
    submit.textContent='Sending...';

    fetch(ENDPOINT,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(data)
    }).then(function(r){
      return r.json().catch(function(){return {};}).then(function(body){
        return {ok:r.ok,body:body};
      });
    }).then(function(res){
      if(res.ok){
        form.reset();
        setStatus('Your message has been sent. Thank you.','ok flash');
      }else{
        setStatus((res.body&&res.body.error)||'Something went wrong. Please try again.','err');
      }
    }).catch(function(){
      setStatus('Could not reach the server. Please try again.','err');
    }).then(function(){
      submit.disabled=false;
      submit.textContent=original;
    });
  });
})();
