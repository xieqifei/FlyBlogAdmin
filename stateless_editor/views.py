from urllib.parse import urlencode

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
from .github_client import ConfigurationError, GitHubContentClient, GitHubError, InvalidArticlePath


def _client():
    return GitHubContentClient()


@require_http_methods(["GET", "POST"])
def login_view(request):
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
