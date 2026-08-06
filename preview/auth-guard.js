(function () {
  var BASE = window.API_BASE || 'https://estofaria-backend.onrender.com';

  function isTokenValid(token) {
    if (!token) return false;
    try {
      var payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp * 1000 > Date.now() + 60000;
    } catch (e) { return false; }
  }

  function applyToken(token) {
    try { localStorage.setItem('auth_token', token); } catch(e) {}
    try { localStorage.setItem('token', token); } catch(e) {}
    try {
      var payload = JSON.parse(atob(token.split('.')[1]));
      window.CURRENT_USER = payload;
      window.AUTH_TOKEN = token;
      window.getAuthToken = function() { return token; };
    } catch(e) {}
  }

  var stored = null;
  try { stored = localStorage.getItem('auth_token') || localStorage.getItem('token'); } catch(e) {}

  if (isTokenValid(stored)) {
    applyToken(stored);
    return;
  }

  var xhr = new XMLHttpRequest();
  xhr.open('POST', BASE + '/api/auth/login', false);
  xhr.setRequestHeader('Content-Type', 'application/json');
  try {
    xhr.send(JSON.stringify({ email: 'owner@demo.local', password: 'Owner123!' }));
    if (xhr.status === 200) {
      var resp = JSON.parse(xhr.responseText);
      var token = resp.token || resp.data?.token || resp.access_token;
      if (token) {
        applyToken(token);
        return;
      }
    }
  } catch(e) {}

  var div = document.createElement('div');
  div.style.cssText = 'position:fixed;inset:0;background:#fff;display:flex;align-items:center;justify-content:center;z-index:9999;font-family:sans-serif;flex-direction:column;gap:16px;';
  div.innerHTML = '<p style="color:#c00;font-size:16px">Não foi possível autenticar no servidor demo.<br>Verifique se o backend está online.</p><button onclick="location.reload()" style="padding:10px 24px;background:#1976d2;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:15px">Tentar novamente</button>';
  document.body.appendChild(div);
})();
