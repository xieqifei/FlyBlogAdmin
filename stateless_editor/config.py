import os


def _has_value(name):
    return bool(os.environ.get(name, "").strip())


def configuration_status():
    """Return public configuration state without exposing any secret values."""
    password_configured = _has_value("ADMIN_PASSWORD_HASH") or _has_value("ADMIN_PASSWORD")
    domain_configured = _has_value("DOMAINS") or any(
        _has_value(name)
        for name in ("VERCEL_URL", "VERCEL_BRANCH_URL", "VERCEL_PROJECT_PRODUCTION_URL")
    )
    return {
        "SECRET_KEY": _has_value("SECRET_KEY"),
        "ADMIN_USERNAME": _has_value("ADMIN_USERNAME"),
        "ADMIN_PASSWORD": password_configured,
        "GITHUB_TOKEN": _has_value("GITHUB_TOKEN"),
        "GITHUB_REPOSITORY": _has_value("GITHUB_REPOSITORY"),
        "DOMAINS": domain_configured,
    }


def configuration_complete():
    return all(configuration_status().values())


def missing_configuration():
    labels = {
        "SECRET_KEY": "SECRET_KEY",
        "ADMIN_USERNAME": "ADMIN_USERNAME",
        "ADMIN_PASSWORD": "ADMIN_PASSWORD_HASH 或 ADMIN_PASSWORD",
        "GITHUB_TOKEN": "GITHUB_TOKEN",
        "GITHUB_REPOSITORY": "GITHUB_REPOSITORY",
        "DOMAINS": "DOMAINS（Vercel 自动域名除外）",
    }
    status = configuration_status()
    return [label for key, label in labels.items() if not status[key]]
