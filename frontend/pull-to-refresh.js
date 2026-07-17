(function () {
  'use strict'

  window.initPullToRefresh = function (onRefresh) {
    var THRESHOLD = 72
    var MAX_PULL  = 110
    var startY    = 0
    var pullY     = 0
    var pulling   = false
    var refreshing = false
    var spinTimer  = null

    var style = document.createElement('style')
    style.textContent = [
      '#ptr-wrap{',
        'position:fixed;top:0;left:0;right:0;',
        'display:flex;justify-content:center;',
        'pointer-events:none;z-index:999999;',
        'transition:transform .25s cubic-bezier(.4,0,.2,1),opacity .25s;',
        'transform:translateY(-72px);opacity:0;',
      '}',
      '#ptr-bubble{',
        'width:46px;height:46px;border-radius:50%;',
        'background:#fff;',
        'box-shadow:0 3px 14px rgba(0,0,0,.18);',
        'display:flex;align-items:center;justify-content:center;',
        'margin-top:10px;',
      '}',
      '#ptr-svg{display:block;transition:transform .15s linear;}',
      '#ptr-spin{',
        'width:22px;height:22px;',
        'border:2.5px solid #d1d9ef;',
        'border-top-color:#4a67a1;',
        'border-radius:50%;',
        'display:none;',
        'animation:ptr-rotate .7s linear infinite;',
      '}',
      '@keyframes ptr-rotate{to{transform:rotate(360deg);}}'
    ].join('')
    document.head.appendChild(style)

    var wrap = document.createElement('div')
    wrap.id = 'ptr-wrap'
    wrap.innerHTML = [
      '<div id="ptr-bubble">',
        '<svg id="ptr-svg" width="22" height="22" viewBox="0 0 24 24"',
          ' fill="none" stroke="#4a67a1" stroke-width="2.5"',
          ' stroke-linecap="round" stroke-linejoin="round">',
          '<polyline points="1 4 1 10 7 10"/>',
          '<path d="M3.51 15a9 9 0 1 0 .49-3.5"/>',
        '</svg>',
        '<div id="ptr-spin"></div>',
      '</div>'
    ].join('')
    document.body.insertBefore(wrap, document.body.firstChild)

    var svg  = document.getElementById('ptr-svg')
    var spin = document.getElementById('ptr-spin')

    function scrollTop() {
      return Math.max(
        document.documentElement.scrollTop || 0,
        document.body.scrollTop || 0
      )
    }

    function setIndicator(pull) {
      if (pull <= 0) {
        wrap.style.transform = 'translateY(-72px)'
        wrap.style.opacity   = '0'
        return
      }
      var ratio     = Math.min(pull / THRESHOLD, 1)
      var translateY = Math.min(pull * 0.55, MAX_PULL * 0.55) - 56
      wrap.style.transition = 'none'
      wrap.style.transform  = 'translateY(' + translateY + 'px)'
      wrap.style.opacity    = String(Math.min(ratio * 1.4, 1))
      svg.style.transform   = 'rotate(' + (pull * 2.8) + 'deg)'
    }

    function hide() {
      wrap.style.transition = 'transform .3s cubic-bezier(.4,0,.2,1),opacity .3s'
      wrap.style.transform  = 'translateY(-72px)'
      wrap.style.opacity    = '0'
    }

    function showSpinner() {
      svg.style.display  = 'none'
      spin.style.display = 'block'
      wrap.style.transition = 'transform .2s cubic-bezier(.4,0,.2,1)'
      wrap.style.transform  = 'translateY(6px)'
      wrap.style.opacity    = '1'
    }

    function hideSpinner() {
      spin.style.display = 'none'
      svg.style.display  = 'block'
      svg.style.transform = 'rotate(0deg)'
      hide()
    }

    document.addEventListener('touchstart', function (e) {
      if (refreshing) return
      if (scrollTop() > 2) return
      startY  = e.touches[0].clientY
      pullY   = 0
      pulling = true
    }, { passive: true })

    document.addEventListener('touchmove', function (e) {
      if (!pulling || refreshing) return
      if (scrollTop() > 2) { pulling = false; setIndicator(0); return }
      var dy = e.touches[0].clientY - startY
      if (dy <= 0) { setIndicator(0); return }
      pullY = dy
      setIndicator(dy)
    }, { passive: true })

    document.addEventListener('touchend', function () {
      if (!pulling) return
      pulling = false
      if (refreshing) return

      if (pullY < THRESHOLD) {
        hide()
        pullY = 0
        return
      }

      pullY = 0
      refreshing = true
      showSpinner()

      Promise.resolve()
        .then(function () { return onRefresh() })
        .catch(function () {})
        .finally(function () {
          refreshing = false
          hideSpinner()
        })
    }, { passive: true })
  }
})()
