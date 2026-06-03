---
name: slides
description: "Cria apresentações visuais no formato HTML/CSS/React para exibição no navegador. Use quando o usuário pedir slides, apresentação, pitch deck, ou demo visual."
---

# Slides — Apresentações em HTML

Cria apresentações estilo slides usando HTML + CSS + JavaScript. O resultado é um único arquivo HTML que abre no navegador.

## Quando Usar

- Pitch deck de produto
- Demo de funcionalidade
- Apresentação de arquitetura
- Relatório visual com dados
- Onboarding / tutorial

## Estrutura de um Slide

Cada slide é uma `<section>` fullscreen com transição CSS:

```html
<!DOCTYPE html>
<html lang="pt-br">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pitch — Product Name</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; }
    .slide {
      width: 100vw;
      height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      padding: 3rem;
      scroll-snap-align: start;
    }
    .container {
      width: 100%;
      max-width: 900px;
      margin: 0 auto;
    }
    h1 { font-size: 3rem; margin-bottom: 1rem; }
    h2 { font-size: 2rem; margin-bottom: 0.75rem; color: #666; }
    p { font-size: 1.25rem; line-height: 1.6; color: #444; }
    .grid { display: grid; gap: 1.5rem; }
    .grid-3 { grid-template-columns: repeat(3, 1fr); }
    .card {
      background: #f8f8f8;
      border-radius: 12px;
      padding: 1.5rem;
      text-align: center;
    }
    .card h3 { font-size: 1.25rem; margin-bottom: 0.5rem; }
    .card p { font-size: 0.9rem; }
    nav {
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      display: flex;
      gap: 0.5rem;
    }
    nav button {
      background: #333;
      color: white;
      border: none;
      border-radius: 50%;
      width: 40px; height: 40px;
      font-size: 1.2rem;
      cursor: pointer;
    }
    .highlight { color: #0070f3; font-weight: 600; }
  </style>
</head>
<body>

<section class="slide" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;">
  <div class="container" style="text-align: center;">
    <h1 style="font-size: 4rem;">Product Name</h1>
    <p style="font-size: 1.5rem; opacity: 0.9;">A plataforma que transforma dados em decisões</p>
    <p style="margin-top: 3rem; font-size: 1rem; opacity: 0.7;">Empresa · 2026</p>
  </div>
</section>

<section class="slide" style="background: white;">
  <div class="container">
    <h1>O Problema</h1>
    <div class="grid grid-3" style="margin-top: 2rem;">
      <div class="card">
        <h3>🚫 Dados Espalhados</h3>
        <p>Informação em planilhas, email, e sistemas diferentes</p>
      </div>
      <div class="card">
        <h3>⏰ Decisões Lentas</h3>
        <p>Relatórios levam dias para serem gerados</p>
      </div>
      <div class="card">
        <h3>🔒 Pouca Visibilidade</h3>
        <p>Gestores não têm dashboards em tempo real</p>
      </div>
    </div>
  </div>
</section>

<section class="slide" style="background: #f5f5f5;">
  <div class="container">
    <h1>A Solução</h1>
    <div class="grid grid-3" style="margin-top: 2rem;">
      <div class="card">
        <h3>📊 Dashboard Central</h3>
        <p>Todos os KPIs em um lugar só</p>
      </div>
      <div class="card">
        <h3>⚡ Tempo Real</h3>
        <p>Dados atualizados a cada minuto</p>
      </div>
      <div class="card">
        <h3>🤖 IA Integrada</h3>
        <p>Insights automáticos com machine learning</p>
      </div>
    </div>
  </div>
</section>

<section class="slide" style="background: white;">
  <div class="container">
    <h1>Arquitetura</h1>
    <p>Frontend React + Vercel · Backend Node.js · Banco Supabase</p>
    <div style="margin-top: 2rem; display: flex; gap: 1rem; flex-wrap: wrap; justify-content: center;">
      <span style="background: #0070f3; color: white; padding: 0.5rem 1rem; border-radius: 8px;">React</span>
      <span style="background: #000; color: white; padding: 0.5rem 1rem; border-radius: 8px;">Vercel</span>
      <span style="background: #3ecf8e; color: white; padding: 0.5rem 1rem; border-radius: 8px;">Supabase</span>
      <span style="background: #f0db4f; color: #333; padding: 0.5rem 1rem; border-radius: 8px;">Node.js</span>
    </div>
  </div>
</section>

<section class="slide" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;">
  <div class="container" style="text-align: center;">
    <h1 style="font-size: 3rem;">Vamos nessa?</h1>
    <p style="font-size: 1.5rem; margin-top: 1rem;">Pronto para transformar seus dados</p>
  </div>
</section>

<script>
  // Navegação com setas
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      window.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      window.scrollBy({ top: -window.innerHeight, behavior: 'smooth' });
    }
  });
</script>

</body>
</html>
```

## Templates de Slide

### Slide de Problema/Solução

```html
<section class="slide">
  <div class="container">
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem;">
      <div style="background: #fee; padding: 2rem; border-radius: 12px;">
        <h2 style="color: #d00;">Antes</h2>
        <ul style="margin-top: 1rem; list-style: none;">
          <li>❌ Processo manual</li>
          <li>❌ Erros frequentes</li>
        </ul>
      </div>
      <div style="background: #efe; padding: 2rem; border-radius: 12px;">
        <h2 style="color: #0a0;">Depois</h2>
        <ul style="margin-top: 1rem; list-style: none;">
          <li>✅ Automático</li>
          <li>✅ 100% preciso</li>
        </ul>
      </div>
    </div>
  </div>
</section>
```

### Slide de Métricas

```html
<section class="slide">
  <div class="container">
    <h1>Resultados</h1>
    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-top: 2rem;">
      <div style="text-align: center;">
        <p style="font-size: 3rem; font-weight: bold; color: #0070f3;">3x</p>
        <p>Mais produtividade</p>
      </div>
      <div style="text-align: center;">
        <p style="font-size: 3rem; font-weight: bold; color: #0070f3;">99.9%</p>
        <p>Uptime</p>
      </div>
      <div style="text-align: center;">
        <p style="font-size: 3rem; font-weight: bold; color: #0070f3;">R$ 2M</p>
        <p>Economia anual</p>
      </div>
    </div>
  </div>
</section>
```

### Slide de Roadmap

```html
<section class="slide">
  <div class="container">
    <h1>Roadmap</h1>
    <div style="margin-top: 2rem;">
      <div style="display: flex; gap: 1rem; align-items: center; margin-bottom: 1rem;">
        <span style="background: #0070f3; color: white; padding: 0.25rem 0.75rem; border-radius: 20px; font-size: 0.8rem;">Q1</span>
        <span>MVP + Dashboard básico</span>
      </div>
      <div style="display: flex; gap: 1rem; align-items: center; margin-bottom: 1rem;">
        <span style="background: #0070f3; color: white; padding: 0.25rem 0.75rem; border-radius: 20px; font-size: 0.8rem;">Q2</span>
        <span>IA Insights + Mobile</span>
      </div>
      <div style="display: flex; gap: 1rem; align-items: center;">
        <span style="background: #666; color: white; padding: 0.25rem 0.75rem; border-radius: 20px; font-size: 0.8rem;">Q3</span>
        <span style="opacity: 0.5;">Integrações de terceiros</span>
      </div>
    </div>
  </div>
</section>
```

## Dicas

- Crie um arquivo HTML único com CSS inline (auto-contido)
- Use `scroll-snap-type: y mandatory` no body para navegação fluida
- Navegação por setas do teclado via JavaScript
- Cada slide é uma `section` fullscreen (100vw × 100vh)
- Use cores da marca e fontes do sistema para consistência
- Acesse o slide abrindo o arquivo no navegador
- Não use frameworks — HTML puro é mais rápido e portátil
