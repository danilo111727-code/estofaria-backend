// deploy force
(function () {
  const LOGIN_PATH = '/login/';
  const pathname = window.location.pathname || '/';
  const base = String(window.API_BASE || '').replace(/\/+$/, '');

  // NÃO proteger a própria tela de login
  if (pathname.startsWith('/login/')) {
    document.documentElement.removeAttribute('data-auth-pending');
    return;
  }

  function goLogin() {
    window.location.href = LOGIN_PATH;
  }

  function clearSession() {
    try {
      if (window.ESTOFARIA_AUTH && typeof window.ESTOFARIA_AUTH.clearSession === 'function') {
        window.ESTOFARIA_AUTH.clearSession();
      } else {
        localStorage.removeItem('estofaria_auth_session_v1');
      }
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      localStorage.removeItem('token');
    } catch (_) {}
  }

  function getToken() {
    try {
      return (
        localStorage.getItem('auth_token') ||
        localStorage.getItem('token') ||
        ''
      );
    } catch (_) {
      return '';
    }
  }

  const token = getToken();

  // sem token → login
  if (!token) {
    goLogin();
    return;
  }

  // interceptador auth
  if (!window.__estofariaAuthFetchInstalled) {
    const rawFetch = window.fetch.bind(window);

    window.fetch = function (input, init) {
      try {
        const url =
          typeof input === 'string'
            ? input
            : (input && input.url) || '';

        const isApi =
          url.includes('/api/') ||
          (base && url.startsWith(base + '/api/'));

        if (isApi) {
          init = init || {};
          init.headers = new Headers(init.headers || {});

          if (!init.headers.get('Authorization')) {
            init.headers.set('Authorization', 'Bearer ' + token);
          }

          if (!init.headers.get('Accept')) {
            init.headers.set('Accept', 'application/json');
          }
        }
      } catch (_) {}

      return rawFetch(input, init).then(function(response) {
        if (response.status === 402) {
          try {
            var target = window.top || window.parent || window;
            var current = String(target.location.pathname || '');
            if (!current.startsWith('/assinatura/') && !current.startsWith('/login/')) {
              target.location.href = '/assinatura/?bloqueado=1';
            }
          } catch (_) {}
        }
        return response;
      });
    };

    window.__estofariaAuthFetchInstalled = true;
  }

  async function validateAuth() {
    try {
      document.documentElement.setAttribute('data-auth-pending', '1');

      const response = await fetch(base + '/api/auth/me', {
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer ' + token,
        },
      });

      // token inválido
      if (response.status === 401) {
        clearSession();
        goLogin();
        return;
      }

      if (!response.ok) {
        throw new Error('auth_error');
      }

      const data = await response.json();

      var authUser = data.user || data || {};
      var isMasterUser = !!(
        authUser.is_master || authUser.is_superadmin ||
        authUser.master_access || authUser.saas_admin ||
        ['platform_admin','superadmin','saas_admin'].indexOf(
          String(authUser.role || '').toLowerCase()
        ) !== -1
      );
      window.EstofariaAuth = {
        user: authUser,
        accessBlocked: false,
        isMaster: isMasterUser,
      };

      // Sessões de impersonação pelo Master nunca são bloqueadas por assinatura
      var isImpersonating = false;
      try { isImpersonating = !!localStorage.getItem('master_impersonating'); } catch(_) {}

      // Verifica access_status para redirecionar usuários comuns sem assinatura ativa
      if (!isMasterUser && !isImpersonating) {
        try {
          // Rota correta: router.get('/') em billingRoutes → /api/subscription/
          var subRes = await fetch(base + '/api/subscription/', {
            headers: { Accept: 'application/json', Authorization: 'Bearer ' + token }
          });
          if (subRes.ok) {
            var subData = await subRes.json();
            var accessStatus = String(
              (subData && subData.subscription && subData.subscription.access_status) ||
              (subData && subData.access_status) || ''
            ).toLowerCase();
            var isBlocked = accessStatus === 'blocked';
            window.EstofariaAuth.accessBlocked = isBlocked;
            if (isBlocked) {
              var topWin = window.top || window.parent || window;
              var cur = String((topWin.location && topWin.location.pathname) || '');
              if (!cur.startsWith('/assinatura/') && !cur.startsWith('/login/')) {
                topWin.location.href = '/assinatura/?bloqueado=1';
                return;
              }
            }
          }
        } catch (_) {}
      }

      document.documentElement.setAttribute('data-auth-ok', '1');
      document.documentElement.removeAttribute('data-auth-pending');

      console.log('Auth OK');
    } catch (err) {
      console.error('AUTH ERROR:', err);

      // evita loop infinito
      clearSession();

      if (!pathname.startsWith('/login/')) {
        goLogin();
      }
    }
  }

  validateAuth();
})();
