#!/usr/bin/env python3
"""_output_guard.py — Shared Output Guard (Porteiro) module.

Provides SENSITIVE_PATTERNS, ALLOWED_ROLES_HIERARCHY, and output_guard()
for RBAC-based output filtering across all hooks (stop.py, post_sprint.py,
session_start.py).
"""

import re


SENSITIVE_PATTERNS = [
    r'(?i)(sk_live_|sk_test_|pk_live_|pk_test_|whsec_|acct_)[A-Za-z0-9]{20,}',
    r'(?i)(api[-_]?key|apikey|secret|password|token|auth_token|private_key)\s*[=:]\s*["\'][^"\'"]{8,}',
    r'(?i)(ghp_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9]{36,}',
    r'(?i)(xox[parbse]-)[A-Za-z0-9-]{20,}',
    r'(?i)(-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----)',
    r'\b\d{3}[-.]?\d{2}[-.]?\d{4}\b',
    r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b',
]

ALLOWED_ROLES_HIERARCHY = {
    "admin": 3,
    "developer": 2,
    "viewer": 1,
}


def get_role_level(user_role: str) -> int:
    return ALLOWED_ROLES_HIERARCHY.get(user_role, 0)


def output_guard(output_text: str, user_role: str) -> tuple[bool, str]:
    """Valida se o output pode ser exibido ao usuario dado seu papel RBAC.

    Returns:
        (blocked: bool, reason: str)
    """
    role_level = get_role_level(user_role)

    if role_level >= 3:
        return False, ""

    sensitive_found = []
    for pattern in SENSITIVE_PATTERNS:
        matches = re.findall(pattern, output_text)
        if matches:
            sensitive_found.append(pattern[:30])

    if sensitive_found:
        if role_level <= 1:
            return True, f"Output bloqueado pelo Porteiro: nivel '{user_role}' nao tem acesso a dados sensiveis ({len(sensitive_found)} padroes detectados)"
        if role_level == 2:
            return True, f"Output bloqueado pelo Porteiro: nivel 'developer' requer sanitizacao de {len(sensitive_found)} dados sensiveis detectados"

    pii_patterns = [r'\b\d{3}\.\d{3}\.\d{3}-\d{2}\b', r'\b\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\b']
    for pp in pii_patterns:
        if re.search(pp, output_text):
            if role_level <= 1:
                return True, f"Output bloqueado pelo Porteiro: PII detectado, nivel '{user_role}' nao autorizado"

    return False, ""
