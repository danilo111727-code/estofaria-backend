(function () {
  const APP_NAME = 'Estofaria Digital';

  const TABS = [
    { href: '../painel/', label: '📊 Painel', match: '/painel' },
    { href: '../material/', label: '🧵 Materiais', match: '/material' },
    { href: '../precificacao/', label: '💰 Precificação', match: '/precificacao' },
    { href: '../catalogo/', label: '🛋️ Catálogo', match: '/catalogo' },
    { href: '../itens-personalizacao/', label: '🎨 Itens para personalização', match: '/itens-personalizacao' },
    { href: '../vendedor/', label: '🤝 Vendedor', match: '/vendedor' },
    { href: '../agenda/', label: '📅 Agenda', match: '/agenda' }
  ];

  function safeJsonParse(value) {
    try {
      return JSON.parse(value);
    } catch (_) {
      return null;
    }
  }

  function readPossibleUserData() {
    const candidates = [
      safeJsonParse(localStorage.getItem('auth_user')),
      safeJsonParse(localStorage.getItem('user')),
      safeJsonParse(localStorage.getItem('usuario')),
      safeJsonParse(localStorage.getItem('session_user'))
    ].filter(Boolean);

    for (const item of candidates) {
      if (item && typeof item === 'object') return item;
    }
    return null;
  }

  function getCompanyName() {
    const user = readPossibleUserData();
    return (
      localStorage.getItem('company_name') ||
      localStorage.getItem('empresa_nome') ||
      localStorage.getItem('estofaria_company_name') ||
      user?.company_name ||
      user?.empresa ||
      APP_NAME
    );
  }

  function getRoleText() {
    const user = readPossibleUserData();

    const role =
      localStorage.getItem('role') ||
      localStorage.getItem('user_role') ||
      user?.role ||
      'Master';

    const name =
      localStorage.getItem('user_name') ||
      localStorage.getItem('username') ||
      user?.name ||
      user?.nome ||
      'master';

    return `${role} · ${name}`;
  }

  function formatNow() {
    return new Date().toLocaleString('pt-BR');
  }

  function buildHeaderHtml() {
    const currentPath = window.location.pathname.replace(/\/+$/, '');

    const tabsHtml = TABS.map(tab => {
      const active = currentPath.endsWith(tab.match) ? ' is-active' : '';
      return `<a class="app-tab${active}" href="${tab.href}">${tab.label}</a>`;
    }).join('');

    return `
      <header class="app-shell-header">
        <div class="app-brand">${APP_NAME}</div>

        <div class="app-top-row">
          <div class="app-company-card">
            <div class="app-company-label">AMBIENTE DA EMPRESA</div>
            <div class="app-company-name">${escapeHtml(getCompanyName())}</div>
            <div class="app-role-badge">${escapeHtml(getRoleText())}</div>
          </div>

          <button type="button" class="app-exit-btn" id="sharedExitBtn">Sair</button>
        </div>

        <div class="app-time-pill" id="sharedHeaderTime">${formatNow()}</div>
      </header>

      <div class="app-tabs-wrap">
        <nav class="app-tabs">
          ${tabsHtml}
        </nav>
      </div>
    `;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function mountSharedHeader() {
    if (document.getElementById('sharedHeaderMount')) return;

    document.body.classList.add('has-shared-header');

    const mount = document.createElement('div');
    mount.id = 'sharedHeaderMount';
    mount.innerHTML = buildHeaderHtml();

    document.body.insertBefore(mount, document.body.firstChild);
  }

  function bindTabTransitions() {
    const links = document.querySelectorAll('.app-tab[href]');
    const currentPath = window.location.pathname.replace(/\/+$/, '');

    links.forEach(link => {
      const target = new URL(link.href, window.location.href);
      const targetPath = target.pathname.replace(/\/+$/, '');

      if (targetPath === currentPath) {
        link.classList.add('is-active');
      }

      link.addEventListener('click', function (e) {
        const href = link.getAttribute('href');
        if (!href) return;
        if (href.startsWith('#')) return;
        if (link.target === '_blank') return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

        e.preventDefault();
        document.body.classList.remove('page-ready');
        document.body.classList.add('page-leaving');

        setTimeout(() => {
          window.location.href = link.href;
        }, 180);
      });
    });
  }

  function bindExitButton() {
    const btn = document.getElementById('sharedExitBtn');
    if (!btn) return;

    btn.addEventListener('click', function () {
      const logoutSelectors = [
        '[data-logout]',
        '.logout-button',
        '#logoutBtn',
        '#btnLogout'
      ];

      for (const selector of logoutSelectors) {
        const el = document.querySelector(selector);
        if (el) {
          el.click();
          return;
        }
      }

      window.location.href = `${window.location.origin}/login/`;
    });
  }

  function startClock() {
    const timeEl = document.getElementById('sharedHeaderTime');
    if (!timeEl) return;

    timeEl.textContent = formatNow();
    setInterval(() => {
      timeEl.textContent = formatNow();
    }, 1000);
  }

  function bootSharedHeader() {
    mountSharedHeader();
    bindTabTransitions();
    bindExitButton();
    startClock();

    requestAnimationFrame(() => {
      document.body.classList.add('page-ready');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootSharedHeader);
  } else {
    bootSharedHeader();
  }
})();
