from pathlib import Path
import json
import logging
import os

from django.core.exceptions import ImproperlyConfigured


BASE_DIR = Path(__file__).resolve().parent.parent


def _env_flag(name, default=False):
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


# This fork is intentionally database-free. Keep the flag for callers and
# templates that use it, but do not allow environment variables to re-enable
# the legacy database-backed application.
STATELESS_MODE = True

_DEVELOPMENT_SECRET_KEY = "django-insecure-qexo-stateless-setup-only"
SECRET_KEY = os.environ.get("QEXO_SECRET_KEY") or os.environ.get("SECRET_KEY") or _DEVELOPMENT_SECRET_KEY
DEBUG = False

# The editor does not use Django models, database sessions, authentication
# tables, migrations, or cache tables.
DATABASES = {}
INSTALLED_APPS = []

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "stateless_editor.middleware.NoStoreMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "core.urls"
WSGI_APPLICATION = "core.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
            ],
        },
    },
]


def _load_allowed_hosts():
    domains_hosts = []
    domains_raw = os.environ.get("DOMAINS")
    if domains_raw:
        try:
            parsed = json.loads(domains_raw)
        except json.JSONDecodeError as exc:
            raise ImproperlyConfigured(f"DOMAINS 环境变量解析失败: {exc}") from exc
        if not isinstance(parsed, (list, tuple)):
            raise ImproperlyConfigured('环境变量 DOMAINS 必须为列表，例如 ["example.com"]')
        domains_hosts = [host for host in parsed if host and host != "*"]

    vercel_hosts = []
    for env_var in ("VERCEL_URL", "VERCEL_BRANCH_URL", "VERCEL_PROJECT_PRODUCTION_URL"):
        url = os.environ.get(env_var)
        if url and url not in vercel_hosts:
            vercel_hosts.append(url)

    if domains_hosts and vercel_hosts:
        hosts = [host for host in domains_hosts if host in vercel_hosts] or list(
            dict.fromkeys(domains_hosts + vercel_hosts)
        )
    else:
        hosts = domains_hosts or vercel_hosts

    if not hosts:
        # Only the public setup guide is reachable until configuration is
        # complete, so it is safe to start before the final domain is known.
        logging.warning("尚未配置 DOMAINS，临时允许访问无数据库配置引导页")
        return ["*"]
    return hosts


def _build_csrf_trusted_origins(hosts):
    origins = []
    for host in hosts:
        if not host or host == "*":
            continue
        host = host.rstrip("/")
        if "://" in host:
            origins.append(host)
        else:
            origins.extend((f"https://{host}", f"http://{host}"))
    return origins


ALLOWED_HOSTS = _load_allowed_hosts()
CSRF_TRUSTED_ORIGINS = _build_csrf_trusted_origins(ALLOWED_HOSTS)

LANGUAGE_CODE = "zh-Hans"
TIME_ZONE = "Asia/Shanghai"
USE_I18N = True
USE_TZ = True

# Authentication state lives in a signed, HTTP-only cookie. Article content is
# read from and written to GitHub; all configuration comes from environment
# variables.
STATELESS_SESSION_AGE = int(os.environ.get("QEXO_SESSION_AGE", "604800"))
STATELESS_COOKIE_SECURE = _env_flag("QEXO_COOKIE_SECURE", bool(os.environ.get("VERCEL")))
CSRF_COOKIE_SECURE = STATELESS_COOKIE_SECURE
SECURE_SSL_REDIRECT = _env_flag("QEXO_SSL_REDIRECT", bool(os.environ.get("VERCEL")))
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
