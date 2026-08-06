(function(){
  function isField(el){
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
  }

  function blurActive(){
    const active = document.activeElement
    if(isField(active)) active.blur()
  }

  function normalizePath(path){
    return String(path || '')
      .replace(/index\.html$/i, '')
      .replace(/\/+$/, '') || '/'
  }

  function findActiveNavLink(nav){
    const links = Array.from(nav.querySelectorAll('a[href]'))
    const current = normalizePath(window.location.pathname)

    return links.find(link => {
      const href = link.getAttribute('href') || ''
      if(!href || href.startsWith('http') || href.startsWith('#')) return false
      const url = new URL(href, window.location.href)
      return normalizePath(url.pathname) === current
    }) || nav.querySelector('.active') || links[0] || null
  }

  function centerActiveNavButton(smooth = false){
    const nav = document.querySelector('.nav')
    if(!nav || nav.scrollWidth <= nav.clientWidth + 4) return

    const activeLink = findActiveNavLink(nav)
    if(!activeLink) return

    const targetLeft = activeLink.offsetLeft - (nav.clientWidth / 2) + (activeLink.clientWidth / 2)
    nav.scrollTo({ left: Math.max(0, targetLeft), behavior: smooth ? 'smooth' : 'auto' })
  }

  const prefetchedUrls = new Set()

  function tryPrefetchUrl(href){
    if(!href || href.startsWith('#') || href.startsWith('javascript:')) return
    try{
      const url = new URL(href, window.location.href)
      if(url.origin !== window.location.origin) return
      if(normalizePath(url.pathname) === normalizePath(window.location.pathname)) return
      const key = url.href
      if(prefetchedUrls.has(key)) return
      prefetchedUrls.add(key)
      const link = document.createElement('link')
      link.rel = 'prefetch'
      link.href = key
      link.as = 'document'
      document.head.appendChild(link)
    }catch(_){ }
  }

  function prefetchNavLinks(){
    const nav = document.querySelector('.nav')
    if(!nav) return
    nav.querySelectorAll('a[href]').forEach(link => tryPrefetchUrl(link.getAttribute('href') || ''))
  }

  let resizeTimer = null

  document.addEventListener('touchstart', function(e){
    const active = document.activeElement
    if(!isField(active)) return
    if(isField(e.target) || (active && active.contains && active.contains(e.target))) return
    blurActive()
  }, { passive:true })

  document.addEventListener('click', function(e){
    const active = document.activeElement
    if(isField(active) && !(isField(e.target) || (active && active.contains && active.contains(e.target)))) {
      blurActive()
    }
  })

  document.addEventListener('keydown', function(e){
    const active = document.activeElement
    if(!isField(active)) return
    if(e.key === 'Enter' && active.tagName !== 'TEXTAREA') blurActive()
    if(e.key === 'Escape') blurActive()
  })

  document.addEventListener('submit', function(){
    blurActive()
  })

  window.addEventListener('load', function(){
    requestAnimationFrame(() => centerActiveNavButton(false))
    if('requestIdleCallback' in window){
      window.requestIdleCallback(() => prefetchNavLinks(), { timeout: 1200 })
    }else{
      setTimeout(prefetchNavLinks, 400)
    }
  })

  document.addEventListener('touchstart', function(e){
    const link = e.target && e.target.closest ? e.target.closest('.nav a[href]') : null
    if(link) tryPrefetchUrl(link.getAttribute('href') || '')
  }, { passive:true })

  document.addEventListener('pointerenter', function(e){
    const link = e.target && e.target.closest ? e.target.closest('.nav a[href]') : null
    if(link) tryPrefetchUrl(link.getAttribute('href') || '')
  }, true)

  window.addEventListener('resize', function(){
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => centerActiveNavButton(false), 80)
  })
})()
