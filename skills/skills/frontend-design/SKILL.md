---
name: frontend-design
description: Premium frontend design with taste-skill integration. Creates distinctive, production-grade interfaces using taste engines (brutalist/soft/minimalist/stitch) + 3 dials (DESIGN_VARIANCE, MOTION_INTENSITY, VISUAL_DENSITY). Detects existing design systems or generates complete ones.
license: MIT
---

# Frontend Design (taste-skill powered)

## 0. DESIGN SYSTEM DETECTION

**Before generating anything, ask the user:**

> *"Você já tem um design system próprio? (caminho da pasta com tokens, ou package npm)"*

### If user provides a design system:
1. **Carregar tokens** — ler arquivos de tema/design system (cores, tipografia, spacing, componentes)
2. **Adaptar os 3 dials** — DESIGN_VARIANCE, MOTION_INTENSITY, VISUAL_DENSITY ajustam-se ao DS existente (ex: se DS tem spacing definido, VISUAL_DENSITY controla compactação relativa)
3. **Ignorar taste-skill engines** — brutalist/soft/minimalist/stitch não se aplicam; usar tom e estilo do DS do usuário
4. **Respeitar tokens existentes** — não sobrescrever cores, fontes, ou componentes já definidos

### If user does NOT have a design system:
1. Perguntar: *"Qual engine de estilo? (brutalist / soft / minimalist / stitch)"*
2. Perguntar: *"Prefere light ou dark mode?"*
3. Aplicar seção 1 (dials) + seção 2 (engine escolhida) para **gerar um design system completo**

---

## 1. THE 3 DIALS (taste-skill)

Estes dials controlam o comportamento visual global. Use os valores base ou adapte conforme requisitos do usuário.

| Dial | Default | Range | Descrição |
|------|---------|-------|-----------|
| **DESIGN_VARIANCE** | 7 | 1-10 | 1=Perfeita simetria, 10=Caos artístico |
| **MOTION_INTENSITY** | 5 | 1-10 | 1=Estático, 10=Física cinemática |
| **VISUAL_DENSITY** | 4 | 1-10 | 1=Galeria de arte/espaçado, 10=Painel de avião/denso |

### DESIGN_VARIANCE por nível
- **1-3 (Previsível):** `justify-center`, grids simétricos 12-col, paddings iguais
- **4-7 (Offset):** `margin-top: -2rem` sobreposições, aspect ratios variados (4:3 + 16:9), headers alinhados à esquerda com dados centralizados
- **8-10 (Assimétrico):** Masonry, `grid-template-columns: 2fr 1fr 1fr`, zonas vazias grandes (`padding-left: 20vw`)
- **Mobile:** Níveis 4-10 devem colapsar para single-column em viewports < 768px

### MOTION_INTENSITY por nível
- **1-3 (Estático):** Sem animações automáticas. Apenas CSS `:hover` e `:active`
- **4-7 (Fluido CSS):** `transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1)`. Cascata `animation-delay` para load-ins. `transform` e `opacity` apenas
- **8-10 (Coreografia avançada):** Scroll-triggered reveals ou parallax. Framer Motion. NUNCA `window.addEventListener('scroll')`

### VISUAL_DENSITY por nível
- **1-3 (Art Gallery):** Muito whitespace. Section gaps enormes. Tudo parece caro e limpo
- **4-7 (App padrão):** Spacing normal para web apps
- **8-10 (Cockpit):** Paddings mínimos. Sem cards — usar `border-t`/`divide-y`. Monospace (`font-mono`) para números. Dados compactados

---

## 2. TASTE ENGINES

Escolha conforme o dialogo com o usuário ou pelo tom do projeto.

### 2a. BRUTALIST ENGINE
*(Raw mechanical interfaces. Swiss typography + military terminal aesthetics.)*

- **Grid:** CSS Grid estrito, bordas sólidas 1-2px, `gap: 1px` com cores contrastantes
- **Border-radius:** ZERO. Cantos 90 graus. Rigidez mecânica
- **Tipografia:** Macro (Neue Haas Grotesk, Inter Black, Archivo Black) em `clamp(4rem, 10vw, 15rem)`, tracking negativo, uppercase. Micro (JetBrains Mono, IBM Plex Mono) em `0.7rem-0.875rem`, tracking generoso
- **Cores (Light):** Background `#F4F4F0`, Foreground `#050505`, Accent `#E61919` (vermelho aviação)
- **Cores (Dark):** Background `#0A0A0A`, Foreground `#EAEAEA`, Accent `#E61919`. Terminal green `#4AF626` opcional
- **Efeitos:** Halftone/dithering, CRT scanlines, ruído mecânico SVG
- **Componentes:** ASCII framing (`[ DELIVERY SYSTEMS ]`), registration marks, crosshairs

### 2b. SOFT ENGINE
*(Expensive, premium soft UI. Refined whitespace, spring animations.)*

- **Tipografia:** Display fonts de alta qualidade combinados com body refinados
- **Cores:** Paletas suaves, saturadas mas não berrantes. Neutros quentes (Warm Gray, Cream)
- **Shadows:** Difusas e amplas (`shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)]`)
- **Border-radius:** Generoso (`rounded-2xl` a `rounded-[2.5rem]`)
- **Motion:** Spring physics (`type: "spring", stiffness: 100, damping: 20`). Nada linear
- **Materialidade:** Glassmorphism refinado com inner borders `border-white/10` + inner shadow
- **Micro-interações:** Perpetuais (pulse, typewriter, float) em componentes isolados

### 2c. MINIMALIST ENGINE
*(Clean editorial. Notion/Linear-inspired. Monochrome with precision.)*

- **Tipografia:** Monochrome stack. `Geist` ou `Satoshi`. Body `text-base leading-relaxed max-w-[65ch]`
- **Cores:** Base neutra absoluta (Zinc/Slate). Single accent de alto contraste (Emerald, Electric Blue, Deep Rose)
- **Layout:** `max-w-[1400px] mx-auto`. Grid sobre flex-math. `min-h-[100dvh]` nunca `h-screen`
- **Cards:** Usar APENAS quando elevação comunica hierarquia. Preferir `border-t`/`divide-y`
- **UI States:** Loading (skeleton), empty (beautiful composition), error (inline reporting obrigatório)
- **Anti-center-bias:** Quando `DESIGN_VARIANCE > 4`, proibido hero centralizado. Forçar split screen ou asymmetrical whitespace
- **3-column card grid:** BANIDO. Usar 2-col zig-zag, asymmetric grid, ou horizontal scroll

### 2d. STITCH ENGINE
*(Google Stitch-compatible semantic design. Premium AI UI generation.)*

- **Design System exportável:** Gera DESIGN.md com tokens completos
- **Componentes semanticos:** headers, sections, grids com marcação semântica clara
- **Acessibilidade:** ARIA labels, roles, keyboard navigation obrigatórios
- **Tema:** Light + Dark mode com CSS variables. Paleta cohesiva
- **Layout:** Bento Grid como padrão (Apple Control Center style)
- **Typography:** Stack premium com fallbacks claros

---

## 3. ANTI-CLICHE RULES (taste-skill)

| BANIDO | Substituir por |
|--------|---------------|
| Inter font | Geist, Outfit, Cabinet Grotesk, Satoshi |
| Purple/violet gradients | Absolute neutrals + high-contrast single accent |
| 3-column card grids | 2-col zig-zag, asymmetric grid, horizontal scroll |
| `h-screen` | `min-h-[100dvh]` |
| Emojis in code | Phosphor icons, Radix icons, ou SVG primitives |
| `justify-center` hero (DESIGN_VARIANCE > 4) | Split screen, left-aligned, asymmetric whitespace |
| Centered `h1` | Hierarchy via weight/color, not massive scale |
| `#000000` | Off-black, Zinc-950, or charcoal |
| Neon/outer glows | Inner borders + tinted shadows |
| Generic names (John Doe, Sarah Chan) | Creative, realistic names |
| Generic avatars | Creative photo placeholders |
| Unsplash | `https://picsum.photos/seed/{random}/800/600` |
| "Elevate", "Seamless", "Next-Gen" | Concrete verbs |
| flexbox percentage math (`calc(33%-1rem)`) | CSS Grid (`grid-cols-3 gap-6`) |

---

## 4. PERFORMANCE GUARDRAILS

- `will-change: transform` — usar com moderação, apenas em elementos animados
- Animar APENAS `transform` e `opacity`. Nunca `top`, `left`, `width`, `height`
- Noise/grain filters em elementos FIXOS com `pointer-events-none` — nunca em scrolling containers
- z-index: usar estritamente por camadas sistêmicas (Sticky Nav, Modal, Overlay). Sem `z-50` arbitrário
- Framer Motion + GSAP/ThreeJS: nunca misturar na mesma árvore de componentes
- Animações perpétuas DEVEM ser memoizadas (`React.memo`) e isoladas em componentes Client próprios

---

## 5. OUTPUT ENFORCEMENT (output-skill integration)

**Banned patterns (hard failure):**
- `// ...`, `// rest of code`, `// implement here`, `// TODO`, `/* ... */`, `// similar to above`
- "let me know if you want me to continue", "for brevity", "the rest follows the same pattern"

**Execution:**
1. Scope — ler request completo. Contar deliverables. Travar número
2. Build — gerar cada deliverable COMPLETO. Nada de rascunhos
3. Cross-check — antes de output: re-ler request original. Comparar count. Se faltar algo, adicionar

**Long outputs:** Se aproximar do token limit, parar em breakpoint limpo e marcar:
```
[PAUSED — X of Y complete. Send "continue" to resume from: next section name]
```

---

## 6. THE CREATIVE ARSENAL (60+ patterns)

Do not default to generic UI. Pull from these categories:

### Heroes
Asymmetric split-screen, left-aligned content + right-aligned asset, curtain reveal, zoom parallax, text mask reveal

### Navigation
Mac OS Dock magnification, magnetic button, gooey menu, dynamic island, contextual radial menu, mega menu reveal

### Grids & Layout
Bento grid (Apple Control Center style), masonry, chroma grid (gradient borders), split screen scroll

### Cards & Containers
Parallax tilt card, spotlight border card, glassmorphism panel, holographic foil card, morphing modal, tinder swipe stack

### Scroll-Animations
Sticky scroll stack, horizontal scroll hijack, locomotive scroll, zoom parallax, scroll progress path, liquid swipe transition

### Galleries
Dome gallery (3D), coverflow carousel, drag-to-pan grid, accordion image slider, hover image trail, glitch effect

### Typography
Kinetic marquee, text scramble, circular text path, gradient stroke animation, kinetic typography grid

### Micro-Interactions
Particle explosion button, liquid pull-to-refresh, skeleton shimmer, directional hover aware, ripple click, animated SVG line, mesh gradient, lens blur depth

---

## 7. BENTO 2.0 PARADIGM

Para SaaS dashboards e feature sections modernos:

**Arquitetura:** Cards `rounded-[2.5rem]`, `#ffffff` sobre `#f9fafb`, diffusion shadow `shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)]`

**5 Card Archetypes:**
1. **Intelligent List** — auto-sorting infinito com `layoutId`
2. **Command Input** — typewriter multi-step + blinking cursor + shimmer gradient
3. **Live Status** — breathing indicators + overshoot notification badge
4. **Wide Data Stream** — infinite carousel horizontal com loop seamless
5. **Contextual UI** — staggered highlight + float-in toolbar

**Motion:** Spring physics em tudo (`type: "spring", stiffness: 100, damping: 20`). `<AnimatePresence>` para listas dinâmicas. `layout` + `layoutId` para transições suaves.

---

## 8. PRE-FLIGHT CHECK

- [ ] DS detection: perguntou se tem design system próprio?
- [ ] Dials configurados: DESIGN_VARIANCE, MOTION_INTENSITY, VISUAL_DENSITY?
- [ ] Engine escolhida (brutalist/soft/minimalist/stitch) OU DS do usuário?
- [ ] Anti-cliché: sem Inter, sem purple, sem `h-screen`, sem emojis?
- [ ] Mobile collapse garantido para `DESIGN_VARIANCE > 4`?
- [ ] Loading, empty, error states implementados?
- [ ] Animações perpétuas isoladas em componentes Client?
- [ ] Output completo — sem `// rest of code` ou `...`?
