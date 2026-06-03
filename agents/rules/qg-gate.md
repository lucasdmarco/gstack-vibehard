---
trigger: always_on
---

# QG Gate — Quality Gate Stage (mandatory for all agents)

**This rule applies to ALL agents. Before delivering ANY output to the user, every agent MUST pass through the Quality Gate.**

## QG Gate Protocol

1. **Before delivering output**, the agent must run:
   ```
   python ~/.codex/hooks/qg.py --path <project_root> --level 1
   ```

2. **If QG returns blockers (CRITICO or ALTO findings):**
   - Stop delivery
   - Fix each CRITICO finding first
   - Fix each ALTO finding second
   - Re-run QG to confirm pass
   - Only then deliver output

3. **If QG returns only MEDIO/BAIXO warnings (no blockers):**
   - Document warnings in the output
   - Deliver normally with a note about minor findings

4. **If QG passes cleanly (no issues):**
   - Deliver output immediately

## Security Gate (for deploy-related tasks)

If the task involves deploy, additionally run:
```
python ~/.codex/hooks/stop.py --security-gate
```

## Integration with agent workflow

```
Agent produces output → Run QG → Pass? → Deliver
                              ↓ No
                         Fix findings → Re-run QG → Pass? → Deliver
```

**This gate is non-negotiable. No agent output bypasses QG.**
