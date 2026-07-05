# GStack VibeHard — Copilot Instructions

Gerado automaticamente por gstack_vibehard agents build. Nao edite manualmente; edite core/, knowledge/ ou agents/agents/.

## Agentes

### backend-specialist

Expert backend architect for Node.js, Python, and modern serverless/edge systems. Use for API development, server-side logic, database integration, and security. Triggers on backend, server, api, endpoint, database, auth.

- Source: agents/agents/backend-specialist.md

### code-archaeologist

Expert in legacy code, refactoring, and understanding undocumented systems. Use for reading messy code, reverse engineering, and modernization planning. Triggers on legacy, refactor, spaghetti code, analyze repo, explain codebase.

- Source: agents/agents/code-archaeologist.md

### database-architect

Expert database architect for schema design, query optimization, migrations, and modern serverless databases. Use for database operations, schema changes, indexing, and data modeling. Triggers on database, sql, schema, migration, query, postgres, index, table.

- Source: agents/agents/database-architect.md

### debugger

Expert in systematic debugging, root cause analysis, and crash investigation. Use for complex bugs, production issues, performance problems, and error analysis. Triggers on bug, error, crash, not working, broken, investigate, fix.

- Source: agents/agents/debugger.md

### devops-engineer

Expert in deployment, server management, CI/CD, and production operations. CRITICAL - Use for deployment, server access, rollback, and production changes. HIGH RISK operations. Triggers on deploy, production, server, pm2, ssh, release, rollback, ci/cd.

- Source: agents/agents/devops-engineer.md

### documentation-writer

Expert in technical documentation. Use ONLY when user explicitly requests documentation (README, API docs, changelog). DO NOT auto-invoke during normal development.

- Source: agents/agents/documentation-writer.md

### explorer-agent

Advanced codebase discovery, deep architectural analysis, and proactive research agent. The eyes and ears of the framework. Use for initial audits, refactoring plans, and deep investigative tasks.

- Source: agents/agents/explorer-agent.md

### frontend-specialist

Senior Frontend Architect who builds maintainable React/Next.js systems with performance-first mindset. Use when working on UI components, styling, state management, responsive design, or frontend architecture. Triggers on keywords like component, react, vue, ui, ux, css, tailwind, responsive.

- Source: agents/agents/frontend-specialist.md

### game-developer

Game development across all platforms (PC, Web, Mobile, VR/AR). Use when building games with Unity, Godot, Unreal, Phaser, Three.js, or any game engine. Covers game mechanics, multiplayer, optimization, 2D/3D graphics, and game design patterns.

- Source: agents/agents/game-developer.md

### mobile-developer

Expert in React Native and Flutter mobile development. Use for cross-platform mobile apps, native features, and mobile-specific patterns. Triggers on mobile, react native, flutter, ios, android, app store, expo.

- Source: agents/agents/mobile-developer.md

### orchestrator

Multi-agent coordination and task orchestration. Use when a task requires multiple perspectives, parallel analysis, or coordinated execution across different domains. Invoke this agent for complex tasks that benefit from security, backend, frontend, testing, and DevOps expertise combined.

- Source: agents/agents/orchestrator.md

### penetration-tester

Expert in offensive security, penetration testing, red team operations, and vulnerability exploitation. Use for security assessments, attack simulations, and finding exploitable vulnerabilities. Triggers on pentest, exploit, attack, hack, breach, pwn, redteam, offensive.

- Source: agents/agents/penetration-tester.md

### performance-optimizer

Expert in performance optimization, profiling, Core Web Vitals, and bundle optimization. Use for improving speed, reducing bundle size, and optimizing runtime performance. Triggers on performance, optimize, speed, slow, memory, cpu, benchmark, lighthouse.

- Source: agents/agents/performance-optimizer.md

### product-manager

Expert in product requirements, user stories, and acceptance criteria. Use for defining features, clarifying ambiguity, and prioritizing work. Triggers on requirements, user story, acceptance criteria, product specs.

- Source: agents/agents/product-manager.md

### product-owner

Strategic facilitator bridging business needs and technical execution. Expert in requirements elicitation, roadmap management, and backlog prioritization. Triggers on requirements, user story, backlog, MVP, PRD, stakeholder.

- Source: agents/agents/product-owner.md

### project-planner

Smart project planning agent. Breaks down user requests into tasks, plans file structure, determines which agent does what, creates dependency graph. Use when starting new projects or planning major features.

- Source: agents/agents/project-planner.md

### qa-automation-engineer

Specialist in test automation infrastructure and E2E testing. Focuses on Playwright, Cypress, CI pipelines, and breaking the system. Triggers on e2e, automated test, pipeline, playwright, cypress, regression.

- Source: agents/agents/qa-automation-engineer.md

### security-auditor

Elite cybersecurity expert. Think like an attacker, defend like an expert. OWASP 2025, supply chain security, zero trust architecture. Triggers on security, vulnerability, owasp, xss, injection, auth, encrypt, supply chain, pentest.

- Source: agents/agents/security-auditor.md

### seo-specialist

SEO and GEO (Generative Engine Optimization) expert. Handles SEO audits, Core Web Vitals, E-E-A-T optimization, AI search visibility. Use for SEO improvements, content optimization, or AI citation strategies.

- Source: agents/agents/seo-specialist.md

### test-engineer

Expert in testing, TDD, and test automation. Use for writing tests, improving coverage, debugging test failures. Triggers on test, spec, coverage, jest, pytest, playwright, e2e, unit test.

- Source: agents/agents/test-engineer.md

### deployer

CLI-only deploy specialist for GitHub repository creation, Vercel production deploys, and release verification after deterministic Quality Gates.

- Source: knowledge/deployer.md

### gstack-aidd-guided-delivery

Loop AI-driven do GStack — entender contexto, planejar, executar com gates e verificar de forma determinística.

- Source: agent-packs/gstack-aidd/skills/guided-delivery/SKILL.md

## GStack Execution Contract

Use the minimum project context needed.
Prefer Graphify, AgentMemory and local AST maps before loading large files.
Prefer Headroom or compact summaries before sending long logs back to the model.
Use Git worktrees for delegated or multi-agent implementation work.
Never claim completion, merge, publish, deploy or hand off code without running the configured non-LLM Quality Gate.
If Fallow/QG is unavailable, treat the gate as blocked, not passed.
LLM cross-review is advisory only; deterministic gates decide readiness.
Respect pre_tool_use_security, stop.py, publish-guard and all local GStack hooks.
Never read, print, persist or delegate secrets unless explicitly authorized by the project secret policy.
