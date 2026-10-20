(() => {
  'use strict';
  const toggle=document.querySelector('.home-menu-toggle');
  const links=document.getElementById('home-navigation');
  if(!toggle||!links)return;
  const nav=toggle.closest('nav'),mobile=window.matchMedia('(max-width: 600px)');
  function setOpen(open) {
    toggle.setAttribute('aria-expanded',String(open));
    links.hidden=mobile.matches&&!open;
  }
  function sync() {
    const focusWasHidden=mobile.matches&&links.contains(document.activeElement);
    const toggleHadFocus=!mobile.matches&&document.activeElement===toggle;
    toggle.hidden=!mobile.matches;
    setOpen(false);
    if(focusWasHidden)toggle.focus({preventScroll:true});
    if(toggleHadFocus)links.querySelector('a')?.focus({preventScroll:true});
  }
  toggle.addEventListener('click',()=>setOpen(toggle.getAttribute('aria-expanded')!=='true'));
  nav.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&mobile.matches&&toggle.getAttribute('aria-expanded')==='true') {
      setOpen(false);toggle.focus({preventScroll:true});event.preventDefault();
    }
  });
  links.addEventListener('click',event=>{if(event.target.closest('a')&&mobile.matches)setOpen(false);});
  document.addEventListener('click',event=>{if(mobile.matches&&!nav.contains(event.target))setOpen(false);});
  mobile.addEventListener('change',sync);
  sync();
})();
