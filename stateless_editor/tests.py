import base64
import os
from unittest import skipUnless
from unittest.mock import Mock, patch

from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.test import Client, SimpleTestCase, override_settings
from django.urls import reverse

from .auth import COOKIE_NAME
from .github_client import GitHubConfig, GitHubContentClient, GitHubError, InvalidArticlePath


class FakeResponse:
    def __init__(self, status_code, data):
        self.status_code = status_code
        self._data = data

    def json(self):
        return self._data


@override_settings(STATELESS_COOKIE_SECURE=False)
@skipUnless(settings.STATELESS_MODE, "requires QEXO_STATELESS=1")
class AuthenticationTests(SimpleTestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {
            "ADMIN_USERNAME": "owner",
            "ADMIN_PASSWORD_HASH": make_password("correct horse battery staple"),
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


@skipUnless(settings.STATELESS_MODE, "requires QEXO_STATELESS=1")
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
                {"path": "source/_posts/hello.md", "type": "blob", "size": 12},
                {"path": "source/_posts/notes/nested.markdown", "type": "blob", "size": 24},
                {"path": "source/_posts/image.png", "type": "blob", "size": 48},
                {"path": "README.md", "type": "blob", "size": 96},
            ],
        })

        articles = self.client.list_articles()

        self.assertEqual([item["path"] for item in articles], ["hello.md", "notes/nested.markdown"])
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


@override_settings(STATELESS_COOKIE_SECURE=False)
@skipUnless(settings.STATELESS_MODE, "requires QEXO_STATELESS=1")
class ArticleViewTests(SimpleTestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {
            "ADMIN_USERNAME": "owner",
            "ADMIN_PASSWORD_HASH": make_password("password-for-tests"),
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.client = Client()
        self.client.post(reverse("login"), {"username": "owner", "password": "password-for-tests"})

    def test_save_failure_preserves_unsaved_content(self):
        fake_client = Mock()
        fake_client.save_article.side_effect = GitHubError("GitHub API 返回 409：冲突")
        with patch("stateless_editor.views._client", return_value=fake_client):
            response = self.client.post(reverse("save_article"), {
                "path": "hello.md",
                "sha": "stale-sha",
                "content": "unsaved text",
            })

        self.assertEqual(response.status_code, 400)
        self.assertContains(response, "unsaved text", status_code=400)
        self.assertContains(response, "冲突", status_code=400)
