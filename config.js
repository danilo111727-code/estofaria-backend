(function () {
  var DEFAULT_API = 'https://estofaria-api-saas.onrender.com';
  var STORAGE_KEY = 'estofaria_api_base_override_v1';

  function normalizeBase(url) {
    return String(url || '').trim().replace(/\/+$/, '');
  }

  function isLocalHost(hostname) {
    var host = String(hostname || '').toLowerCase();
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.endsWith('.local')
    );
  }

  function getQueryApiOverride() {
    try {
      var params = new URLSearchParams(window.location.search || '');
      return normalizeBase(params.get('api'));
    } catch (err) {
      return '';
    }
  }

  function getStoredApiOverride() {
    try {
      return normalizeBase(window.localStorage.getItem(STORAGE_KEY));
    } catch (err) {
      return '';
    }
  }

  function setStoredApiOverride(value) {
    try {
      if (value) {
        window.localStorage.setItem(STORAGE_KEY, value);
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch (err) {}
  }

  function resolveApiBase() {
    try {
      var localEnv = isLocalHost(window.location.hostname);
      var queryOverride = getQueryApiOverride();
      var storedOverride = getStoredApiOverride();

      if (localEnv) {
        var chosen = queryOverride || storedOverride || DEFAULT_API;
        chosen = normalizeBase(chosen) || DEFAULT_API;
        setStoredApiOverride(chosen);
        window.ESTOFARIA_ALLOW_API_OVERRIDE = true;
        return chosen;
      }

      setStoredApiOverride('');
      window.ESTOFARIA_ALLOW_API_OVERRIDE = false;
      return DEFAULT_API;
    } catch (err) {
      window.ESTOFARIA_ALLOW_API_OVERRIDE = false;
      return DEFAULT_API;
    }
  }

  var API_BASE = resolveApiBase();

  window.API_BASE = API_BASE;

  window.ESTOFARIA_ENDPOINTS = {
    auth: {
      login: '/auth/login',
      register: '/auth/register',
      me: '/auth/me',
      forgotPassword: '/auth/forgot-password'
    },
    saas: {
      companies: '/saas/companies',
      companyActions: '/saas/companies/:companyId/actions',
      companyAudit: '/saas/companies/:companyId/audit'
    },
    billing: {
      public: '/billing/public',
      subscription: '/billing/subscription',
      checkout: '/billing/checkout',
      customerPortal: '/billing/customer-portal',
      config: '/billing/config',
      leads: '/billing/leads',
      webhookSummary: '/billing/webhook-summary'
    },
    team: {
      list: '/auth/team',
      invite: '/auth/team/invite',
      updateUser: '/auth/team/users/:userId',
      deactivateUser: '/auth/team/users/:userId/deactivate',
      reactivateUser: '/auth/team/users/:userId/reactivate'
    }
  };

  window.__ESTOFARIA_CONFIG__ = {
    apiBase: API_BASE,
    allowApiOverride: !!window.ESTOFARIA_ALLOW_API_OVERRIDE,
    environment: window.ESTOFARIA_ALLOW_API_OVERRIDE ? 'development' : 'production'
  };
})();
