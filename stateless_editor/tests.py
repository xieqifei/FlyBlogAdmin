import base64
import json
import os
from unittest.mock import Mock, patch

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.test import Client, SimpleTestCase, override_settings
from django.urls import reverse

from .auth import COOKIE_NAME
from .front_matter import (
    article_path_from_title,
    build_article,
    parse_article,
    parse_custom_fields,
    split_list,
)
from .github_client import GitHubConfig, GitHubContentClient, GitHubError, InvalidArticlePath
from .llm_client import LLMClient, LLMConfigurationError


class FakeResponse:
    def __init__(self, status_code, data):
        self.status_code = status_code
        self._data = data

    def json(self):
        return self._data


@override_settings(STATELESS_COOKIE_SECURE=False)
class AuthenticationTests(SimpleTestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {
            "QEXO_SECRET_KEY": "test-secret-key",
            "ADMIN_USERNAME": "owner",
            "ADMIN_PASSWORD_HASH": make_password("correct horse battery staple"),
            "QEXO_GITHUB_TOKEN": "test-token",
            "QEXO_GITHUB_REPOSITORY": "owner/blog",
            "DOMAINS": '["testserver"]',
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.client = Client()

    def test_private_pages_redirect_to_login(self):
        response = self.client.get(reverse("home"))
        self.assertEqual(response.status_code, 302)
        self.assertTrue(response.url.startswith(reverse("login")))

    def test_login_creates_signed_cookie_and_allows_article_list(self):
        response = self.client.post(reverse("login"), {
            "username": "owner",
            "password": "correct horse battery staple",
        })
        self.assertEqual(response.status_code, 302)
        self.assertIn(COOKIE_NAME, response.cookies)
        self.assertTrue(response.cookies[COOKIE_NAME]["httponly"])

        fake_client = Mock()
        fake_client.list_articles.return_value = []
        fake_client.config.repository = "owner/blog"
        fake_client.config.branch = "main"
        with patch("stateless_editor.views._client", return_value=fake_client):
            response = self.client.get(reverse("home"))
        self.assertEqual(response.status_code, 200)

    def test_invalid_password_does_not_create_cookie(self):
        response = self.client.post(reverse("login"), {
            "username": "owner",
            "password": "wrong",
        })
        self.assertEqual(response.status_code, 200)
        self.assertNotIn(COOKIE_NAME, response.cookies)
        self.assertContains(response, "用户名或密码错误")

    def test_changing_password_hash_invalidates_existing_cookie(self):
        self.client.post(reverse("login"), {
            "username": "owner",
            "password": "correct horse battery staple",
        })

        with patch.dict(os.environ, {"ADMIN_PASSWORD_HASH": make_password("new password")}):
            response = self.client.get(reverse("home"))

        self.assertEqual(response.status_code, 302)
        self.assertTrue(response.url.startswith(reverse("login")))

    def test_plaintext_password_environment_variable_is_supported(self):
        with patch.dict(os.environ, {
            "ADMIN_PASSWORD_HASH": "",
            "ADMIN_PASSWORD": "plain password for tests",
        }):
            response = self.client.post(reverse("login"), {
                "username": "owner",
                "password": "plain password for tests",
            })

        self.assertEqual(response.status_code, 302)
        self.assertIn(COOKIE_NAME, response.cookies)

    def test_password_hash_takes_precedence_over_plaintext(self):
        with patch.dict(os.environ, {
            "ADMIN_PASSWORD_HASH": make_password("hashed password wins"),
            "ADMIN_PASSWORD": "plain password for tests",
        }):
            response = self.client.post(reverse("login"), {
                "username": "owner",
                "password": "plain password for tests",
            })

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "用户名或密码错误")

    def test_changing_plaintext_password_invalidates_existing_cookie(self):
        with patch.dict(os.environ, {
            "ADMIN_PASSWORD_HASH": "",
            "ADMIN_PASSWORD": "original plain password",
        }):
            self.client.post(reverse("login"), {
                "username": "owner",
                "password": "original plain password",
            })
            with patch.dict(os.environ, {"ADMIN_PASSWORD": "changed plain password"}):
                response = self.client.get(reverse("home"))

        self.assertEqual(response.status_code, 302)
        self.assertTrue(response.url.startswith(reverse("login")))

    def test_editor_responses_are_not_cacheable(self):
        fake_client = Mock()
        fake_client.list_articles.return_value = []
        fake_client.config.repository = "owner/blog"
        fake_client.config.branch = "main"
        self.client.post(reverse("login"), {
            "username": "owner",
            "password": "correct horse battery staple",
        })
        with patch("stateless_editor.views._client", return_value=fake_client):
            response = self.client.get(reverse("home"))

        self.assertEqual(response["Cache-Control"], "no-store, max-age=0")


class GitHubContentClientTests(SimpleTestCase):
    def setUp(self):
        self.config = GitHubConfig(
            token="secret-token",
            repository="owner/blog",
            branch="main",
            posts_path="source/_posts",
            extensions=(".md", ".markdown"),
        )
        self.session = Mock()
        self.client = GitHubContentClient(self.config, session=self.session)

    def test_lists_only_articles_under_configured_directory(self):
        self.session.request.return_value = FakeResponse(200, {
            "truncated": False,
            "tree": [
                {"path": "source/_posts/hello.md", "type": "blob", "size": 12, "sha": "blob-1"},
                {"path": "source/_posts/notes/nested.markdown", "type": "blob", "size": 24},
                {"path": "source/_posts/image.png", "type": "blob", "size": 48},
                {"path": "README.md", "type": "blob", "size": 96},
            ],
        })

        articles = self.client.list_articles()

        self.assertEqual([item["path"] for item in articles], ["hello.md", "notes/nested.markdown"])
        self.assertEqual(articles[0]["sha"], "blob-1")
        request_headers = self.session.request.call_args.kwargs["headers"]
        self.assertEqual(request_headers["Authorization"], "Bearer secret-token")

    def test_reads_base64_content_with_github_line_wrapping(self):
        encoded = base64.b64encode("你好，Qexo".encode()).decode()
        wrapped = encoded[:8] + "\n" + encoded[8:]
        self.session.request.return_value = FakeResponse(200, {
            "type": "file",
            "encoding": "base64",
            "sha": "abc123",
            "content": wrapped,
        })

        article = self.client.get_article("hello.md")

        self.assertEqual(article["content"], "你好，Qexo")
        self.assertEqual(article["sha"], "abc123")

    def test_reads_article_last_modified_from_latest_commit(self):
        self.session.request.return_value = FakeResponse(200, [{
            "commit": {"committer": {"date": "2026-08-29T12:30:00Z"}},
        }])

        modified = self.client.get_article_last_modified("notes/hello world.md")

        self.assertEqual(modified, "2026-08-29T12:30:00Z")
        request_url = self.session.request.call_args.args[1]
        self.assertIn("path=source%2F_posts%2Fnotes%2Fhello%20world.md", request_url)
        self.assertIn("per_page=1", request_url)

    def test_update_includes_sha_for_conflict_protection(self):
        self.session.request.return_value = FakeResponse(200, {"commit": {"sha": "new"}})

        self.client.save_article("hello.md", "content", sha="old-sha")

        payload = self.session.request.call_args.kwargs["json"]
        self.assertEqual(payload["sha"], "old-sha")
        self.assertEqual(payload["branch"], "main")

    def test_blank_commit_message_uses_default(self):
        self.session.request.return_value = FakeResponse(201, {"commit": {"sha": "new"}})

        self.client.save_article("hello.md", "content", message="   ")

        payload = self.session.request.call_args.kwargs["json"]
        self.assertEqual(payload["message"], "Update hello.md from Qexo")

    def test_rejects_paths_outside_article_directory(self):
        for path in ("../secret.md", "/absolute.md", "folder\\file.md", "image.png"):
            with self.subTest(path=path):
                with self.assertRaises(InvalidArticlePath):
                    self.client.normalize_article_path(path)

    def test_github_error_does_not_include_token(self):
        self.session.request.return_value = FakeResponse(409, {"message": "sha does not match"})

        with self.assertRaisesRegex(GitHubError, "409") as caught:
            self.client.save_article("hello.md", "content", sha="stale")

        self.assertNotIn("secret-token", str(caught.exception))


class FrontMatterTests(SimpleTestCase):
    def test_parse_article_keeps_managed_fields_and_body(self):
        content = (
            "---\n"
            "layout: post\n"
            "title: \"Hello World\"\n"
            "date: 2026-08-30\n"
            "tags:\n"
            "  - AI\n"
            "  - Markdown\n"
            "categories:\n"
            "  - Notes\n"
            "cover: https://example.com/cover.jpg\n"
            "description: 摘要\n"
            "custom: keep-me\n"
            "---\n\n"
            "# 正文\n"
        )

        parsed = parse_article(content)

        self.assertEqual(parsed["title"], "Hello World")
        self.assertEqual(parsed["date"], "2026-08-30")
        self.assertEqual(parsed["tags"], ["AI", "Markdown"])
        self.assertEqual(parsed["categories"], ["Notes"])
        self.assertEqual(parsed["cover"], "https://example.com/cover.jpg")
        self.assertEqual(parsed["description"], "摘要")
        self.assertEqual(parsed["body"], "# 正文")
        self.assertIn("custom: keep-me", parsed["front_matter"])

    def test_build_article_updates_managed_fields_and_preserves_custom_fields(self):
        parsed = parse_article(
            "---\nlayout: post\ntitle: Old\ndate: 2026-08-30\n"
            "tags:\n  - Old\ncustom: keep-me\n---\n\nbody\n"
        )

        rebuilt = build_article(parsed["front_matter"], parsed["body"], {
            "title": "New Title",
            "date": "2026-08-31",
            "tags": ["AI", "Markdown"],
            "categories": ["Notes"],
            "cover": "",
            "description": "摘要",
        })

        self.assertIn("title: \"New Title\"", rebuilt)
        self.assertIn("date: \"2026-08-31\"", rebuilt)
        self.assertIn("- \"AI\"", rebuilt)
        self.assertIn("- \"Markdown\"", rebuilt)
        self.assertIn("- \"Notes\"", rebuilt)
        self.assertIn("custom: keep-me", rebuilt)
        self.assertNotIn("Old", rebuilt)
        self.assertTrue(rebuilt.startswith("---\n"))
        self.assertTrue(rebuilt.endswith("body"))

    def test_parse_article_without_front_matter_returns_body(self):
        parsed = parse_article("plain body")

        self.assertEqual(parsed["front_matter"], "")
        self.assertEqual(parsed["body"], "plain body")
        self.assertEqual(parsed["title"], "")

    def test_parse_article_exposes_complex_legacy_metadata_without_losing_body(self):
        content = (
            "\ufeff---\n"
            "title: Legacy\n"
            "date: 2025-02-03 12:34:56\n"
            "description: |\n"
            "  第一行\n"
            "  第二行\n"
            "categories:\n"
            "  - [技术, 前端]\n"
            "mathjax: true\n"
            "extra:\n"
            "  nested: value\n"
            "...\n\n"
            "开头\n\n中间\n\n结尾"
        )

        parsed = parse_article(content)

        self.assertEqual(parsed["date"], "2025-02-03 12:34:56")
        self.assertEqual(parsed["description"], "第一行\n第二行\n")
        self.assertEqual(parsed["categories"], [["技术", "前端"]])
        self.assertEqual(parsed["categories_text"], '["技术", "前端"]')
        self.assertEqual(parsed["body"], "开头\n\n中间\n\n结尾")
        self.assertEqual(parsed["custom_fields"], [
            {"name": "mathjax", "value": "true"},
            {"name": "extra", "value": '{"nested": "value"}'},
        ])

    def test_custom_fields_accept_structured_values_and_reject_managed_names(self):
        fields = parse_custom_fields(
            ["mathjax", "keywords", "nested"],
            ["true", '["AI", "Hexo"]', '{"enabled": false}'],
        )

        self.assertEqual(fields, {
            "mathjax": True,
            "keywords": ["AI", "Hexo"],
            "nested": {"enabled": False},
        })
        with self.assertRaises(ValueError):
            parse_custom_fields(["title"], ["duplicate"])

    def test_legacy_template_values_remain_visible_when_yaml_is_not_parseable(self):
        parsed = parse_article(
            "---\ntitle: Draft\ndate: {{ date }}\nlegacy: {{ slug }}\n---\n\nBody"
        )

        self.assertEqual(parsed["title"], "Draft")
        self.assertEqual(parsed["date"], "{{ date }}")
        self.assertEqual(parsed["custom_fields"], [
            {"name": "legacy", "value": "{{ slug }}"},
        ])
        self.assertEqual(parsed["body"], "Body")

    def test_split_list_handles_commas_and_newlines(self):
        self.assertEqual(split_list("AI, Markdown，写作\nHexo"), ["AI", "Markdown", "写作", "Hexo"])

    def test_article_path_from_title_generates_slug(self):
        self.assertEqual(article_path_from_title("Hello World! 2026"), "hello-world-2026.md")
        self.assertEqual(article_path_from_title("你好 世界"), "你好-世界.md")
        self.assertRegex(article_path_from_title("   "), r"^article-\d{4}-\d{2}-\d{2}\.md$")


@override_settings(STATELESS_COOKIE_SECURE=False)
class ArticleViewTests(SimpleTestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {
            "QEXO_SECRET_KEY": "test-secret-key",
            "ADMIN_USERNAME": "owner",
            "ADMIN_PASSWORD_HASH": make_password("password-for-tests"),
            "QEXO_GITHUB_TOKEN": "test-token",
            "QEXO_GITHUB_REPOSITORY": "owner/blog",
            "DOMAINS": '["testserver"]',
            "QEXO_LLM_API_KEY": "test-llm-key",
            "QEXO_LLM_MODEL": "test-model",
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.client = Client()
        self.client.post(reverse("login"), {"username": "owner", "password": "password-for-tests"})

    def test_edit_page_uses_metadata_form_and_body_editor(self):
        fake_client = Mock()
        fake_client.get_article.return_value = {
            "path": "hello.md",
            "sha": "sha-1",
            "content": "---\ntitle: Hello\ntags:\n  - AI\n---\n\n# Body\n",
        }
        with patch("stateless_editor.views._client", return_value=fake_client):
            response = self.client.get(reverse("edit_article") + "?path=hello.md")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'name="title"')
        self.assertContains(response, 'name="body"')
        self.assertContains(response, 'name="front_matter"')
        self.assertContains(response, 'name="tags"')
        self.assertNotContains(response, 'name="content"')
        self.assertNotContains(response, 'name="commit_message"')
        self.assertContains(response, "打开 StackEdit 编辑器")
        self.assertContains(response, reverse("stackedit_script"))
        self.assertContains(response, "# Body")

    def test_stackedit_bridge_is_served_without_staticfiles_app(self):
        response = self.client.get(reverse("stackedit_script"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "text/javascript; charset=utf-8")
        self.assertContains(response, "global.Stackedit = Stackedit")

    def test_edit_page_displays_long_body_and_all_custom_metadata(self):
        long_body = "开始\n" + ("很长的历史正文\n" * 2000) + "正文结尾标记"
        fake_client = Mock()
        fake_client.get_article.return_value = {
            "path": "legacy.md",
            "sha": "sha-legacy",
            "content": (
                "---\ntitle: Legacy\ndate: 2025-02-03 12:34:56\n"
                "mathjax: true\nkeywords: [AI, Hexo]\n---\n\n" + long_body
            ),
        }
        with patch("stateless_editor.views._client", return_value=fake_client):
            response = self.client.get(reverse("edit_article") + "?path=legacy.md")

        self.assertContains(response, "正文结尾标记")
        self.assertContains(response, 'name="custom_key" value="mathjax"')
        self.assertContains(response, 'name="custom_key" value="keywords"')
        self.assertContains(response, 'value="2025-02-03 12:34:56"')

    def test_home_has_new_article_button_without_quick_create_form(self):
        fake_client = Mock()
        fake_client.list_articles.return_value = []
        fake_client.config.repository = "owner/blog"
        fake_client.config.branch = "main"
        with patch("stateless_editor.views._client", return_value=fake_client):
            response = self.client.get(reverse("home"))

        self.assertContains(response, "新建文章")
        self.assertNotContains(response, "快捷创建")
        self.assertNotContains(response, 'id="quick-title"')

    def test_home_sorts_and_filters_articles_by_front_matter(self):
        fake_client = Mock()
        fake_client.config.repository = "owner/blog"
        fake_client.config.branch = "main"
        fake_client.list_articles.return_value = [
            {"path": "older.md", "name": "older", "size": 10},
            {"path": "newer.md", "name": "newer", "size": 20},
            {"path": "draft.md", "name": "draft", "size": 30},
        ]
        fake_client.get_article.side_effect = lambda path: {"content": {
            "older.md": "---\ntitle: Alpha\ndate: 2025-01-01\nupdated: 2026-01-02\ncategories: [Tech]\ntags: [Django]\n---\n",
            "newer.md": "---\ntitle: Beta\ndate: 2026-03-01\nupdated: 2026-03-02\ncategories: [Tech]\ntags: [Python]\n---\n",
            "draft.md": "---\ntitle: Gamma\ndate: 2026-04-01\nupdated: 2026-04-02\ncategories: [Life]\ntags: [Travel]\n---\n",
        }[path]}

        with patch("stateless_editor.views._client", return_value=fake_client):
            response = self.client.get(reverse("home"), {
                "sort": "published",
                "category": "Tech",
                "tag": "Python",
            })

        self.assertEqual([article["title"] for article in response.context["articles"]], ["Beta"])
        self.assertEqual(response.context["categories"], ["Life", "Tech"])
        self.assertEqual(response.context["tags"], ["Django", "Python", "Travel"])
        self.assertContains(response, "发布日期（最新优先）")
        self.assertContains(response, "分类 · Tech")
        fake_client.get_article_last_modified.assert_not_called()

    def test_home_falls_back_to_github_commit_for_modified_sort(self):
        fake_client = Mock()
        fake_client.config.repository = "owner/blog"
        fake_client.config.branch = "main"
        fake_client.list_articles.return_value = [
            {"path": "alpha.md", "name": "alpha", "size": 10},
            {"path": "beta.md", "name": "beta", "size": 20},
        ]
        fake_client.get_article.side_effect = lambda path: {
            "content": f"---\ntitle: {path[:-3].title()}\ndate: 2026-01-01\n---\n"
        }
        fake_client.get_article_last_modified.side_effect = {
            "alpha.md": "2026-01-03T00:00:00Z",
            "beta.md": "2026-01-04T00:00:00Z",
        }.get

        with patch("stateless_editor.views._client", return_value=fake_client):
            response = self.client.get(reverse("home"))

        self.assertEqual([article["title"] for article in response.context["articles"]], ["Beta", "Alpha"])
        self.assertEqual(fake_client.get_article_last_modified.call_count, 2)

    def test_home_name_sort_uses_front_matter_title_and_searches_it(self):
        fake_client = Mock()
        fake_client.config.repository = "owner/blog"
        fake_client.config.branch = "main"
        fake_client.list_articles.return_value = [
            {"path": "z-file.md", "name": "z-file", "size": 10},
            {"path": "a-file.md", "name": "a-file", "size": 20},
        ]
        fake_client.get_article.side_effect = lambda path: {"content": {
            "z-file.md": "---\ntitle: Apple\nupdated: 2026-01-01\n---\n",
            "a-file.md": "---\ntitle: Zebra\nupdated: 2026-01-01\n---\n",
        }[path]}

        with patch("stateless_editor.views._client", return_value=fake_client):
            response = self.client.get(reverse("home"), {"sort": "name", "q": "app"})

        self.assertEqual([article["title"] for article in response.context["articles"]], ["Apple"])

    def test_home_has_accessible_settings_link_to_setup_guide(self):
        fake_client = Mock()
        fake_client.list_articles.return_value = []
        fake_client.config.repository = "owner/blog"
        fake_client.config.branch = "main"
        with patch("stateless_editor.views._client", return_value=fake_client):
            response = self.client.get(reverse("home"))

        self.assertContains(response, f'href="{reverse("setup")}"')
        self.assertContains(response, 'aria-label="打开设置与配置引导"')

        guide = self.client.get(reverse("setup"))
        self.assertEqual(guide.status_code, 200)
        self.assertContains(guide, "QEXO_GITHUB_TOKEN")

    def test_edit_page_accepts_quick_create_title(self):
        response = self.client.get(reverse("edit_article") + "?title=Quick")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'value="Quick"')
        self.assertNotContains(response, 'name="path"')

    def test_save_new_article_generates_path_and_writes_metadata(self):
        fake_client = Mock()
        with patch("stateless_editor.views._client", return_value=fake_client):
            response = self.client.post(reverse("save_article"), {
                "title": "Hello World",
                "date": "2026-08-30",
                "tags": "AI, Markdown",
                "categories": "Notes",
                "cover": "",
                "description": "摘要",
                "front_matter": "",
                "body": "# 正文",
                "commit_message": "",
            })

        self.assertRedirects(response, reverse("home") + "?saved=1", fetch_redirect_response=False)
        saved_path = fake_client.save_article.call_args.args[0]
        saved_content = fake_client.save_article.call_args.args[1]
        self.assertEqual(saved_path, "hello-world.md")
        self.assertIn('title: "Hello World"', saved_content)
        self.assertIn('date: "2026-08-30"', saved_content)
        self.assertIn('- "AI"', saved_content)
        self.assertIn('- "Markdown"', saved_content)
        self.assertIn('- "Notes"', saved_content)
        self.assertIn("# 正文", saved_content)
        self.assertNotIn("message", fake_client.save_article.call_args.kwargs)

    def test_save_preserves_nested_categories_and_custom_fields(self):
        fake_client = Mock()
        with patch("stateless_editor.views._client", return_value=fake_client):
            response = self.client.post(reverse("save_article"), {
                "path": "legacy.md",
                "sha": "sha-legacy",
                "title": "Legacy",
                "date": "2025-02-03 12:34:56",
                "tags": "AI\nHexo",
                "categories": '["技术", "前端"]',
                "description": "第一行\n第二行",
                "front_matter": "title: Old\nobsolete: remove-me",
                "body": "完整正文",
                "custom_key": ["mathjax", "keywords"],
                "custom_value": ["true", '["AI", "Hexo"]'],
            })

        self.assertRedirects(response, reverse("home") + "?saved=1", fetch_redirect_response=False)
        saved_content = fake_client.save_article.call_args.args[1]
        self.assertIn('date: "2025-02-03 12:34:56"', saved_content)
        self.assertIn('- "技术"', saved_content)
        self.assertIn('description: "第一行\\n第二行"', saved_content)
        self.assertIn("mathjax: true", saved_content)
        self.assertIn("keywords:", saved_content)
        self.assertNotIn("obsolete", saved_content)

    def test_save_failure_preserves_unsaved_content(self):
        fake_client = Mock()
        fake_client.save_article.side_effect = GitHubError("GitHub API 返回 409：冲突")
        with patch("stateless_editor.views._client", return_value=fake_client):
            response = self.client.post(reverse("save_article"), {
                "path": "hello.md",
                "sha": "stale-sha",
                "title": "Unsaved",
                "front_matter": "",
                "body": "unsaved text",
                "tags": "AI",
                "categories": "Notes",
            })

        self.assertEqual(response.status_code, 400)
        self.assertContains(response, "unsaved text", status_code=400)
        self.assertContains(response, "Unsaved", status_code=400)
        self.assertContains(response, "冲突", status_code=400)

    def test_save_requires_title(self):
        response = self.client.post(reverse("save_article"), {
            "front_matter": "",
            "body": "正文",
        })

        self.assertEqual(response.status_code, 400)
        self.assertContains(response, "请填写文章标题", status_code=400)


class LLMClientTests(SimpleTestCase):
    def test_chat_completion_returns_optimized_text(self):
        session = Mock()
        session.post.return_value = FakeResponse(200, {
            "choices": [{"message": {"content": "优化后正文"}}],
        })
        client = LLMClient(
            api_key="key",
            model="model",
            base_url="https://api.example.com/v1",
            api_style="chat",
            session=session,
        )

        result = client.optimize("原文", "优化表达")

        self.assertEqual(result, "优化后正文")
        request_url = session.post.call_args.args[0]
        self.assertEqual(request_url, "https://api.example.com/v1/chat/completions")
        payload = session.post.call_args.kwargs["json"]
        self.assertIn("优化表达", payload["messages"][1]["content"])
        self.assertNotIn("原文", payload["messages"][1]["content"].split("待编辑内容：")[0])

    def test_auto_mode_falls_back_to_responses_api(self):
        session = Mock()
        session.post.side_effect = [
            FakeResponse(404, {}),
            FakeResponse(200, {"output_text": "优化后正文"}),
        ]
        client = LLMClient(
            api_key="key",
            model="model",
            base_url="https://api.example.com/v1",
            api_style="auto",
            session=session,
        )

        result = client.optimize("原文", "优化表达")

        self.assertEqual(result, "优化后正文")
        self.assertEqual(session.post.call_count, 2)
        self.assertEqual(session.post.call_args.args[0], "https://api.example.com/v1/responses")

    def test_missing_credentials_raises_configuration_error(self):
        with patch.dict(os.environ, {
            "QEXO_LLM_API_KEY": "",
            "QEXO_LLM_MODEL": "",
            "QEXO_LLM_BASE_URL": "https://api.example.com/v1",
            "QEXO_LLM_API_STYLE": "auto",
        }):
            with self.assertRaises(LLMConfigurationError):
                LLMClient()


@override_settings(STATELESS_COOKIE_SECURE=False)
class LLMViewTests(SimpleTestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {
            "QEXO_SECRET_KEY": "test-secret-key",
            "ADMIN_USERNAME": "owner",
            "ADMIN_PASSWORD_HASH": make_password("password-for-tests"),
            "QEXO_GITHUB_TOKEN": "test-token",
            "QEXO_GITHUB_REPOSITORY": "owner/blog",
            "DOMAINS": '["testserver"]',
            "QEXO_LLM_API_KEY": "test-llm-key",
            "QEXO_LLM_MODEL": "test-model",
            "QEXO_LLM_BASE_URL": "https://api.example.com/v1",
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.client = Client()
        self.client.post(reverse("login"), {"username": "owner", "password": "password-for-tests"})

    def test_optimize_endpoint_returns_ai_rewritten_body(self):
        fake_llm = Mock()
        fake_llm.optimize.return_value = "优化后正文"
        with patch("stateless_editor.views.LLMClient", return_value=fake_llm):
            response = self.client.post(
                reverse("optimize_article"),
                data=json.dumps({"content": "原文", "mode": "optimize"}),
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["content"], "优化后正文")


@override_settings(STATELESS_COOKIE_SECURE=False)
class SetupGuideTests(SimpleTestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {
            "QEXO_SECRET_KEY": "",
            "SECRET_KEY": "",
            "ADMIN_USERNAME": "",
            "ADMIN_PASSWORD_HASH": "",
            "ADMIN_PASSWORD": "",
            "QEXO_GITHUB_TOKEN": "",
            "QEXO_GITHUB_REPOSITORY": "",
            "DOMAINS": "",
            "VERCEL_URL": "",
            "VERCEL_BRANCH_URL": "",
            "VERCEL_PROJECT_PRODUCTION_URL": "",
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.client = Client()

    def test_incomplete_configuration_redirects_editor_and_login_to_setup(self):
        for route in ("home", "login"):
            with self.subTest(route=route):
                response = self.client.get(reverse(route))
                self.assertRedirects(response, reverse("setup"), fetch_redirect_response=False)

    def test_setup_page_explains_required_variables_without_exposing_values(self):
        response = self.client.get(reverse("setup"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "QEXO_GITHUB_TOKEN")
        self.assertContains(response, "ADMIN_PASSWORD_HASH")
        self.assertContains(response, "Contents")

    def test_setup_page_never_echoes_environment_secrets(self):
        secrets = {
            "ADMIN_PASSWORD": "environment plaintext secret",
            "QEXO_GITHUB_TOKEN": "github_pat_environment_secret",
        }
        with patch.dict(os.environ, secrets):
            response = self.client.get(reverse("setup"))

        self.assertEqual(response.status_code, 200)
        for value in secrets.values():
            self.assertNotContains(response, value)

    def test_setup_page_generates_verifiable_password_hash(self):
        password = "a private password for setup"
        response = self.client.post(reverse("setup"), {
            "password": password,
            "password_confirmation": password,
        })

        self.assertEqual(response.status_code, 200)
        encoded = response.context["password_hash"]
        self.assertTrue(check_password(password, encoded))
        self.assertNotContains(response, password)

    def test_setup_page_rejects_mismatched_passwords(self):
        response = self.client.post(reverse("setup"), {
            "password": "a sufficiently long password",
            "password_confirmation": "another sufficiently long password",
        })

        self.assertContains(response, "两次输入的密码不一致")
        self.assertEqual(response.context["password_hash"], "")


class StatelessSettingsTests(SimpleTestCase):
    def test_database_mode_cannot_be_enabled_by_environment_variables(self):
        self.assertTrue(settings.STATELESS_MODE)
        self.assertEqual(settings.DATABASES["default"]["ENGINE"], "django.db.backends.dummy")
        self.assertEqual(settings.INSTALLED_APPS, [])

    def test_setup_does_not_require_a_mode_switch(self):
        from .config import configuration_status

        self.assertNotIn("QEXO_STATELESS", configuration_status())
