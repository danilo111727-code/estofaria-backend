(function(){
  var CV = '20260805c';
  var ROUTES = {
    'painel':               { path:'/painel/',               content:'/painel/__content.html?v='+CV,               title:'Painel' },
    'material':             { path:'/material/',             content:'/material/__content.html?v='+CV,             title:'Materiais' },
    'precificacao':         { path:'/precificacao/',         content:'/precificacao/__content.html?v='+CV,         title:'Precificação' },
    'catalogo':             { path:'/catalogo/',             content:'/catalogo/__content.html?v='+CV,             title:'Catálogo' },
    'itens-personalizacao': { path:'/itens-personalizacao/', content:'/itens-personalizacao/__content.html?v='+CV, title:'Itens para personalização' },
    'vendedor':             { path:'/vendedor/',             content:'/vendedor/__content.html?v='+CV,             title:'Vendedor' },
    'agenda':               { path:'/agenda/',               content:'/agenda/__content.html?v='+CV,               title:'Agenda' },
    'financeiro':           { path:'/financeiro/',           content:'/financeiro/__content.html?v='+CV,           title:'Financeiro' },
    'configuracao':         { path:'/configuracao/',         content:'/configuracao/__content.html?v='+CV,         title:'Configuração' },
    'assinatura':           { path:'/assinatura/',           content:'/assinatura/__content.html?v='+CV,           title:'Assinatura' },
    'master':               { path:'/master/',               content:'/master/__content.html?v='+CV,               title:'Master' }
  };

  var wrap    = document.querySelector('.content-frame-wrap');
  var loading = document.getElementById('shellLoading');

  // Multi-frame pool — one iframe per module, kept alive after first load.
  // Subsequent tab switches are instant (just display:none <-> display:block).
  var framePool    = {};   // code -> <iframe>
  var frameLoaded  = {};   // code -> bool (true once the iframe's load event fired)
  var currentModule = null;
  var resizeTimers  = {};

  function scrollToTop(){
    try { window.scrollTo({ top:0, behavior:'instant' }); } catch(_){}
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }

  function normalizePath(p){
    p = String(p || '/');
    return p.endsWith('/') ? p : p + '/';
  }

  function resolveModuleFromPath(path){
    var n = normalizePath(path);
    return Object.keys(ROUTES).find(function(k){
      return n.indexOf(ROUTES[k].path) === 0;
    }) || 'painel';
  }

  function getRoute(code){ return ROUTES[code] || ROUTES.painel; }

  function setActiveNav(code){
    document.querySelectorAll('.nav a[data-module]').forEach(function(a){
      var active = a.getAttribute('data-module') === code;
      a.classList.toggle('active', active);
      if(active) a.setAttribute('aria-current','page');
      else a.removeAttribute('aria-current');
    });
    var ml = document.querySelector('.nav a.auth-master-link');
    if(ml){
      var im = code === 'master';
      ml.classList.toggle('active', im);
      if(im) ml.setAttribute('aria-current','page');
      else ml.removeAttribute('aria-current');
    }
  }

  function setTitle(code){
    document.title = 'Estofaria Digital — ' + getRoute(code).title;
  }

  function iframeDoc(f){
    try { return f.contentDocument || f.contentWindow.document; } catch(_){ return null; }
  }

  function injectFrameStyles(doc){
    if(!doc || doc.getElementById('app-shell-hide-chrome')) return;
    var s = doc.createElement('style');
    s.id = 'app-shell-hide-chrome';
    s.textContent = '.header,.nav{display:none !important}' +
      'html,body{margin:0 !important;padding:0 !important;background:transparent !important}' +
      'body{overflow-x:hidden !important}' +
      '.container,.page-shell,.itens-page,h1,.topo{margin-top:0 !important}';
    doc.head.appendChild(s);
  }

  // Injeta relay de touch no iframe para que o PTR do shell receba os gestos.
  // Os iframes capturam todos os eventos de toque — eles nunca chegam ao documento
  // pai. Este script reenvia touchstart/move/end via postMessage.
  function injectPtrRelay(doc){
    if(!doc || doc.getElementById('app-shell-ptr-relay')) return;
    var s = doc.createElement('script');
    s.id = 'app-shell-ptr-relay';
    s.textContent = '(function(){' +
      'if(window.__ptrRelayInstalled)return;window.__ptrRelayInstalled=true;' +
      'var sY=0,cDy=0,act=false;' +
      'function st(){return Math.max(document.documentElement.scrollTop||0,document.body.scrollTop||0)}' +
      'document.addEventListener("touchstart",function(e){' +
        'cDy=0;act=false;if(st()>2)return;' +
        'sY=e.touches[0].clientY;act=true;' +
        'try{window.parent.postMessage({type:"ptr-touch-start",y:sY},"*")}catch(_){}' +
      '},{passive:true});' +
      'document.addEventListener("touchmove",function(e){' +
        'if(!act)return;' +
        'if(st()>2){act=false;try{window.parent.postMessage({type:"ptr-touch-cancel"},"*")}catch(_){}return}' +
        'cDy=e.touches[0].clientY-sY;if(cDy<=0)return;' +
        'try{window.parent.postMessage({type:"ptr-touch-move",dy:cDy},"*")}catch(_){}' +
      '},{passive:true});' +
      'document.addEventListener("touchend",function(){' +
        'if(!act)return;act=false;' +
        'try{window.parent.postMessage({type:"ptr-touch-end",dy:cDy},"*")}catch(_){}' +
        'cDy=0;' +
      '},{passive:true});' +
      'document.addEventListener("touchcancel",function(){' +
        'if(!act)return;act=false;' +
        'try{window.parent.postMessage({type:"ptr-touch-cancel"},"*")}catch(_){}' +
        'cDy=0;' +
      '},{passive:true});' +
    '})();';
    try{ (doc.head||doc.body||doc.documentElement).appendChild(s); }catch(_){}
  }

  function syncHeight(f){
    var doc = iframeDoc(f);
    if(!doc) return;
    injectFrameStyles(doc);
    injectPtrRelay(doc);
    var html = doc.documentElement, body = doc.body;
    var h = Math.max(
      html ? html.scrollHeight : 0, body ? body.scrollHeight : 0,
      html ? html.offsetHeight : 0, body ? body.offsetHeight : 0,
      600
    );
    f.style.height = h + 'px';
  }

  function installObservers(f, code){
    var doc = iframeDoc(f);
    if(!doc) return;
    injectFrameStyles(doc);
    injectPtrRelay(doc);
    var rerun = function(){
      clearTimeout(resizeTimers[code]);
      resizeTimers[code] = setTimeout(function(){ syncHeight(f); }, 30);
    };
    try {
      new MutationObserver(rerun).observe(
        doc.documentElement || doc.body,
        { childList:true, subtree:true, attributes:true, characterData:true }
      );
    } catch(_){}
    try {
      f.contentWindow.addEventListener('resize', rerun);
      doc.addEventListener('click', function(e){
        var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
        if(!a) return;
        var href = a.getAttribute('href') || '';
        var m = Object.keys(ROUTES).find(function(k){
          return href === '../' + k + '/' || href === '/' + k + '/' || href === ROUTES[k].path;
        });
        if(m){ e.preventDefault(); navigate(m, true); }
      });
    } catch(_){}
    [80, 250, 700, 1400].forEach(function(t){
      setTimeout(function(){ syncHeight(f); }, t);
    });
  }

  // Get or create the cached iframe for a module.
  function getFrame(code){
    if(framePool[code]) return framePool[code];

    var route = getRoute(code);
    var src   = route.content + (route.content.includes('?') ? '&' : '?') + 'shell=1';

    var f = document.createElement('iframe');
    f.className  = 'content-frame shell-frame';
    f.title      = 'Conteúdo do módulo';
    f.setAttribute('scrolling', 'no');
    f.style.cssText = 'display:none;width:100%;border:0;' +
                      'min-height:calc(100vh - 120px);background:transparent;';

    f.addEventListener('load', function(){
      syncHeight(f);
      installObservers(f, code);
      setTimeout(function(){
        syncHeight(f);
        frameLoaded[code] = true;
        if(currentModule === code){
          f.style.display = 'block';
          // 'material' defers the loading hide until materiais.js signals via
          // estofaria-content-ready (after renderMaterials resolves).
          // All other modules hide loading immediately as before.
          if(code !== 'material'){
            if(loading) loading.classList.add('hidden');
          } else {
            // Safety fallback: force-hide after 5 s if the signal never arrives.
            setTimeout(function(){
              if(loading) loading.classList.add('hidden');
            }, 5000);
          }
        }
      }, 220);
    });

    wrap.appendChild(f);
    framePool[code] = f;
    f.src = src;
    return f;
  }

  function showFrame(code){
    var nextF    = getFrame(code);    // creates or retrieves from pool
    var isCached = !!frameLoaded[code];

    function doSwitch(){
      // Hide ALL frames that are not the target — robust, no prevCode tracking needed
      Object.keys(framePool).forEach(function(k){
        if(framePool[k] !== nextF) framePool[k].style.display = 'none';
      });
      // Only reveal immediately for already-loaded (cached) frames.
      // Uncached frames stay hidden until their load event fires, preventing the
      // raw-HTML flash on any first visit to a module.
      if(isCached) nextF.style.display = 'block';
      scrollToTop();
      if(isCached){
        if(loading) loading.classList.add('hidden');
        setTimeout(function(){ syncHeight(nextF); }, 30);
      } else {
        if(loading) loading.classList.remove('hidden');
      }
    }

    // View Transitions API: smooth cross-fade on instant (cached) switches
    if(isCached && typeof document.startViewTransition === 'function'){
      document.startViewTransition(doSwitch);
    } else {
      doSwitch();
    }
  }

  function loadModule(code, push){
    currentModule = code;
    setActiveNav(code);
    setTitle(code);
    if(push) history.pushState({ module:code }, '', getRoute(code).path);
    showFrame(code);
  }

  function navigate(code, push){
    if(code === currentModule) return;
    loadModule(code, push);
  }

  document.querySelector('.nav').addEventListener('click', function(e){
    var link = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if(!link) return;
    var code = link.getAttribute('data-module') ||
               resolveModuleFromPath(link.getAttribute('href') || '');
    if(!code || !ROUTES[code]) return;
    e.preventDefault();
    navigate(code, true);
  });

  window.addEventListener('message', function(e){
    if(!e || !e.data) return;
    var f = currentModule && framePool[currentModule];
    var t = e.data.type;
    if(t === 'estofaria-shell-height'){
      if(f) syncHeight(f);
    }
    if(t === 'estofaria-content-ready'){
      if(f){ f.style.display = 'block'; syncHeight(f); }
      if(loading) loading.classList.add('hidden');
    }
    if(t === 'estofaria-scroll-top') scrollToTop();
    // Relay: qualquer iframe envia → shell encaminha ao painel
    if(t === 'estofaria-notify-painel'){
      var pf = framePool['painel'];
      if(pf && pf.contentWindow) pf.contentWindow.postMessage(e.data, '*');
    }
  });

  window.addEventListener('resize', function(){
    var f = currentModule && framePool[currentModule];
    if(f) syncHeight(f);
  });
  window.addEventListener('orientationchange', function(){
    var f = currentModule && framePool[currentModule];
    if(f) setTimeout(function(){ syncHeight(f); }, 300);
  });
  window.addEventListener('popstate', function(){
    loadModule(resolveModuleFromPath(location.pathname), false);
  });

  loadModule(resolveModuleFromPath(location.pathname), false);
  setTimeout(function(){ setActiveNav(resolveModuleFromPath(location.pathname)); }, 200);
  setTimeout(function(){ setActiveNav(resolveModuleFromPath(location.pathname)); }, 800);

  // === Pull to Refresh ===
  (function(){
    function ptrInit(){
      if(typeof window.initPullToRefresh !== 'function') return;
      window.initPullToRefresh(function(){
        return new Promise(function(resolve){
          var f = currentModule && framePool[currentModule];
          if(!f || !f.contentWindow){ resolve(); return; }
          var done = false;
          var timer = setTimeout(function(){
            if(!done){ done = true; resolve(); }
          }, 6000);
          var handler = function(e){
            if(e.data && e.data.type === 'estofaria-ptr-done'){
              if(!done){ done = true; clearTimeout(timer); window.removeEventListener('message', handler); resolve(); }
            }
          };
          window.addEventListener('message', handler);
          f.contentWindow.postMessage({ type: 'estofaria-ptr-refresh' }, '*');
        });
      });
    }
    if(document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', ptrInit);
    } else {
      ptrInit();
    }
  })();
})();
