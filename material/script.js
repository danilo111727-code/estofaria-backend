<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Estofaria Digital</title>
  <link rel="stylesheet" href="mobile-fixes.css">
  <script src="config.js"></script>
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-KK3X46X3JM"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-KK3X46X3JM');
</script>
</head>
<body>
  <p>Redirecionando...</p>
  <script>
    (function(){
      try {
        var auth = window.ESTOFARIA_AUTH || null
        var token = auth && typeof auth.getToken === 'function'
          ? auth.getToken()
          : (localStorage.getItem('auth_token') || localStorage.getItem('token') || '')
        window.location.replace(token ? '/painel/' : '/login/')
      } catch (_) {
        window.location.replace('/login/')
      }
    })()
  </script>
  <script src="keyboard-dismiss.js"></script>
</body>
</html>
