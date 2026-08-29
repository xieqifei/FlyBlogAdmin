import secrets
from urllib.parse import urlencode

from django.contrib.auth.hashers import make_password
from django.http import HttpResponse
from django.shortcuts import redirect, render
from django.urls import reverse
from django.views.decorators.http import require_GET, require_http_methods, require_POST

from .auth import (
    clear_session_cookie,
    credentials_configured,
    login_required,
    read_session_cookie,
    safe_next_url,
    set_session_cookie,
    verify_credentials,
)
from .config import configuration_complete, configuration_status, missing_configuration
from .github_client import ConfigurationError, GitHubContentClient, GitHubError, InvalidArticlePath


def _client():
    return GitHubContentClient()


@require_http_methods(["GET", "POST"])
def login_view(request):
    if not configuration_complete():
        return redirect("setup")
    if read_session_cookie(request):
        return redirect("home")

    error = ""
    next_url = request.POST.get("next") or request.GET.get("next") or ""
    if request.method == "POST":
        if not credentials_configured():
            error = "管理员环境变量尚未配置"
        elif verify_credentials(request.POST.get("username", ""), request.POST.get("password", "")):
            destination = safe_next_url(request, next_url)
            response = redirect(destination)
            set_session_cookie(response, request.POST.get("username", ""))
            return response
        else:
            error = "用户名或密码错误"
    return render(request, "stateless/login.html", {"error": error, "next": next_url})


@require_http_methods(["GET", "POST"])
def setup_view(request):
    complete = configuration_complete()
    if complete and not read_session_cookie(request):
        return redirect(reverse("login") + "?next=" + reverse("setup"))

    password_hash = ""
    error = ""
    if request.method == "POST":
        password = request.POST.get("password", "")
        confirmation = request.POST.get("password_confirmation", "")
        if len(password) < 12:
            error = "密码至少需要 12 个字符"
        elif password != confirmation:
            error = "两次输入的密码不一致"
        else:
            password_hash = make_password(password)

    return render(request, "stateless/setup.html", {
        "configuration_complete": complete,
        "configuration_status": configuration_status(),
        "missing_configuration": missing_configuration(),
        "generated_secret_key": secrets.token_urlsafe(48),
        "password_hash": password_hash,
        "error": error,
    })


@require_POST
def logout_view(request):
    response = redirect("login")
    clear_session_cookie(response)
    return response


@require_GET
@login_required
def article_list(request):
    query = request.GET.get("q", "").strip()
    error = ""
    articles = []
    repository = ""
    branch = ""
    try:
        client = _client()
        articles = client.list_articles(query)
        repository = client.config.repository
        branch = client.config.branch
    except (ConfigurationError, GitHubError) as exc:
        error = str(exc)
    return render(request, "stateless/articles.html", {
        "articles": articles,
        "query": query,
        "error": error,
        "repository": repository,
        "branch": branch,
        "saved": request.GET.get("saved") == "1",
        "deleted": request.GET.get("deleted") == "1",
    })


@require_GET
@login_required
def edit_article(request):
    article_path = request.GET.get("path", "")
    article = {"path": "", "sha": "", "content": "---\ntitle: \n---\n\n"}
    error = request.GET.get("error", "")
    if article_path:
        try:
            article = _client().get_article(article_path)
        except (ConfigurationError, GitHubError, InvalidArticlePath) as exc:
            error = str(exc)
    return render(request, "stateless/edit.html", {"article": article, "error": error})


@require_POST
@login_required
def save_article(request):
    article_path = request.POST.get("path", "").strip()
    content = request.POST.get("content", "")
    sha = request.POST.get("sha", "").strip()
    commit_message = request.POST.get("commit_message", "").strip()
    try:
        client = _client()
        client.save_article(article_path, content, sha=sha, message=commit_message)
    except (ConfigurationError, GitHubError, InvalidArticlePath) as exc:
        return render(request, "stateless/edit.html", {
            "article": {"path": article_path, "sha": sha, "content": content},
            "error": str(exc),
        }, status=400)
    return redirect(reverse("home") + "?saved=1")


@require_POST
@login_required
def delete_article(request):
    article_path = request.POST.get("path", "").strip()
    sha = request.POST.get("sha", "").strip()
    try:
        _client().delete_article(article_path, sha)
    except (ConfigurationError, GitHubError, InvalidArticlePath) as exc:
        query = urlencode({"path": article_path, "error": str(exc)})
        return redirect(reverse("edit_article") + "?" + query)
    return redirect(reverse("home") + "?deleted=1")


@require_GET
def robots(request):
    return HttpResponse("User-agent: *\nDisallow: /\n", content_type="text/plain")
