import json
import os
import secrets
from pathlib import Path, PurePosixPath
from urllib.parse import urlencode, urlsplit

from django.contrib.auth.hashers import make_password
from django.http import HttpResponse, JsonResponse
from django.shortcuts import redirect, render
from django.urls import reverse
from django.utils.timezone import localdate
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
from .front_matter import (
    article_path_from_title,
    build_article,
    parse_article,
    parse_custom_fields,
    split_list,
)
from .llm_client import LLMClient, LLMConfigurationError, LLMError


STACKEDIT_SCRIPT_PATH = (
    Path(__file__).resolve().parent
    / "static/stateless/vendor/stackedit/stackedit.js"
)


def _client():
    return GitHubContentClient()


def _ai_configured():
    return bool(
        os.environ.get("QEXO_LLM_API_KEY", "").strip()
        and os.environ.get("QEXO_LLM_MODEL", "").strip()
    )


def _stackedit_url():
    value = os.environ.get("QEXO_STACKEDIT_URL", "https://stackedit.io/app").strip()
    parsed = urlsplit(value)
    if parsed.scheme in {"http", "https"} and parsed.netloc:
        return value
    return "https://stackedit.io/app"


def _render_editor(request, article, editor, error="", status=200):
    return render(request, "stateless/edit.html", {
        "article": article,
        "editor": editor,
        "error": error,
        "ai_configured": _ai_configured(),
        "stackedit_url": _stackedit_url(),
    }, status=status)


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
    article = {"path": "", "sha": "", "content": ""}
    error = request.GET.get("error", "")
    if article_path:
        try:
            article = _client().get_article(article_path)
        except (ConfigurationError, GitHubError, InvalidArticlePath) as exc:
            error = str(exc)
    editor = parse_article(article["content"])
    if article_path:
        if not editor["title"]:
            editor["title"] = PurePosixPath(article_path).stem
    else:
        editor["date"] = editor["date"] or localdate().isoformat()
        title = request.GET.get("title", "").strip()
        if title:
            editor["title"] = title
    return _render_editor(request, article, editor, error)


@require_POST
@login_required
def save_article(request):
    title = request.POST.get("title", "").strip()
    body = request.POST.get("body", "")
    metadata = {
        "title": title,
        "date": request.POST.get("date", "").strip(),
        "tags": split_list(request.POST.get("tags", "")),
        "categories": split_list(request.POST.get("categories", "")),
        "cover": request.POST.get("cover", "").strip(),
        "description": request.POST.get("description", "").strip(),
    }
    custom_field_names = request.POST.getlist("custom_key")
    custom_field_values = request.POST.getlist("custom_value")
    posted_editor = {
        "front_matter": request.POST.get("front_matter", ""),
        "body": body,
        "tags_text": request.POST.get("tags", ""),
        "categories_text": request.POST.get("categories", ""),
        "custom_fields": [
            {"name": name, "value": value}
            for name, value in zip(custom_field_names, custom_field_values)
        ],
        **metadata,
    }
    article_path = request.POST.get("path", "").strip()
    if not title:
        return _render_editor(request, {
            "path": article_path,
            "sha": request.POST.get("sha", "").strip(),
            "content": "",
        }, posted_editor, "请填写文章标题", status=400)
    try:
        custom_fields = parse_custom_fields(custom_field_names, custom_field_values)
    except ValueError as exc:
        return _render_editor(request, {
            "path": article_path,
            "sha": request.POST.get("sha", "").strip(),
            "content": "",
        }, posted_editor, str(exc), status=400)
    if not article_path:
        article_path = article_path_from_title(title)
    content = build_article(
        request.POST.get("front_matter", ""),
        body,
        metadata,
        custom_fields=custom_fields,
    )
    sha = request.POST.get("sha", "").strip()
    try:
        client = _client()
        client.save_article(article_path, content, sha=sha)
    except (ConfigurationError, GitHubError, InvalidArticlePath) as exc:
        return _render_editor(request, {
            "path": article_path,
            "sha": sha,
            "content": content,
        }, posted_editor, str(exc), status=400)
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


@require_POST
@login_required
def optimize_article(request):
    try:
        payload = json.loads(request.body)
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({"error": "请求格式无效"}, status=400)
    content = str(payload.get("content", "")).strip()
    mode = str(payload.get("mode", "optimize"))
    custom_instruction = str(payload.get("instruction", "")).strip()[:500]
    instructions = {
        "optimize": "优化表达与文章结构，使语言自然流畅、逻辑清晰，并保持原有语气。",
        "proofread": "校对错别字、语法和标点，只做必要修改。",
        "shorten": "在保留关键信息的前提下精简内容，删除重复和空泛表达。",
        "expand": "在不杜撰事实的前提下补足论述和衔接，让内容更完整。",
        "custom": custom_instruction,
    }
    instruction = instructions.get(mode, "")
    if not content or len(content) > 100_000:
        return JsonResponse({"error": "请选择正文，且内容不能超过 100000 个字符"}, status=400)
    if not instruction:
        return JsonResponse({"error": "请输入 AI 编辑要求"}, status=400)
    try:
        optimized = LLMClient().optimize(content, instruction)
    except LLMConfigurationError as exc:
        return JsonResponse({"error": str(exc)}, status=503)
    except LLMError as exc:
        return JsonResponse({"error": str(exc)}, status=502)
    return JsonResponse({"content": optimized})


@require_GET
def stackedit_script(request):
    return HttpResponse(
        STACKEDIT_SCRIPT_PATH.read_bytes(),
        content_type="text/javascript; charset=utf-8",
    )


@require_GET
def robots(request):
    return HttpResponse("User-agent: *\nDisallow: /\n", content_type="text/plain")
