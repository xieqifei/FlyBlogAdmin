import hmac
import hashlib
import os
from functools import wraps
from urllib.parse import urlencode

from django.conf import settings
from django.contrib.auth.hashers import check_password
from django.core import signing
from django.shortcuts import redirect
from django.urls import reverse
from django.utils.http import url_has_allowed_host_and_scheme


COOKIE_NAME = "qexo_editor_session"
COOKIE_SALT = "qexo.stateless-editor.session.v1"


def credentials_configured():
    return bool(os.environ.get("ADMIN_USERNAME") and os.environ.get("ADMIN_PASSWORD_HASH"))


def verify_credentials(username, password):
    expected_username = os.environ.get("ADMIN_USERNAME", "")
    encoded_password = os.environ.get("ADMIN_PASSWORD_HASH", "")
    username_matches = hmac.compare_digest(username.encode("utf-8"), expected_username.encode("utf-8"))
    password_matches = check_password(password, encoded_password) if encoded_password else False
    return username_matches and password_matches


def _credential_version():
    encoded_password = os.environ.get("ADMIN_PASSWORD_HASH", "")
    return hmac.new(
        settings.SECRET_KEY.encode("utf-8"),
        encoded_password.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def create_session_cookie(username):
    return signing.dumps({
        "username": username,
        "credential_version": _credential_version(),
    }, salt=COOKIE_SALT, compress=True)


def read_session_cookie(request):
    value = request.COOKIES.get(COOKIE_NAME)
    if not value:
        return None
    try:
        payload = signing.loads(value, salt=COOKIE_SALT, max_age=settings.STATELESS_SESSION_AGE)
    except signing.BadSignature:
        return None
    username = payload.get("username") if isinstance(payload, dict) else None
    credential_version = payload.get("credential_version") if isinstance(payload, dict) else None
    expected_username = os.environ.get("ADMIN_USERNAME", "")
    if (
        not username
        or not credential_version
        or not hmac.compare_digest(username, expected_username)
        or not hmac.compare_digest(credential_version, _credential_version())
    ):
        return None
    return username


def set_session_cookie(response, username):
    response.set_cookie(
        COOKIE_NAME,
        create_session_cookie(username),
        max_age=settings.STATELESS_SESSION_AGE,
        httponly=True,
        secure=settings.STATELESS_COOKIE_SECURE,
        samesite="Lax",
        path="/",
    )


def clear_session_cookie(response):
    response.delete_cookie(
        COOKIE_NAME,
        path="/",
        samesite="Lax",
    )


def safe_next_url(request, candidate, default_name="home"):
    if candidate and url_has_allowed_host_and_scheme(
        candidate,
        allowed_hosts={request.get_host()},
        require_https=request.is_secure(),
    ):
        return candidate
    return reverse(default_name)


def login_required(view):
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        username = read_session_cookie(request)
        if not username:
            login_url = reverse("login")
            return redirect(f"{login_url}?{urlencode({'next': request.get_full_path()})}")
        request.stateless_username = username
        return view(request, *args, **kwargs)

    return wrapped
