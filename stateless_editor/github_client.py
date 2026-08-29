import base64
import os
import re
from dataclasses import dataclass
from pathlib import PurePosixPath
from urllib.parse import quote

import requests


class ConfigurationError(Exception):
    pass


class GitHubError(Exception):
    pass


class InvalidArticlePath(ValueError):
    pass


@dataclass(frozen=True)
class GitHubConfig:
    token: str
    repository: str
    branch: str
    posts_path: str
    extensions: tuple

    @classmethod
    def from_environment(cls):
        token = os.environ.get("QEXO_GITHUB_TOKEN", "").strip()
        repository = os.environ.get("QEXO_GITHUB_REPOSITORY", "").strip()
        branch = os.environ.get("QEXO_GITHUB_BRANCH", "main").strip()
        posts_path = os.environ.get("QEXO_POSTS_PATH", "source/_posts").strip().strip("/")
        raw_extensions = os.environ.get("QEXO_POST_EXTENSIONS", ".md,.markdown")
        extensions = tuple(
            extension if extension.startswith(".") else f".{extension}"
            for extension in (item.strip().lower() for item in raw_extensions.split(","))
            if extension
        )

        missing = []
        if not token:
            missing.append("QEXO_GITHUB_TOKEN")
        if not repository:
            missing.append("QEXO_GITHUB_REPOSITORY")
        if not branch:
            missing.append("QEXO_GITHUB_BRANCH")
        if missing:
            raise ConfigurationError("缺少环境变量：" + "、".join(missing))
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
            raise ConfigurationError("QEXO_GITHUB_REPOSITORY 必须为 owner/repository 格式")
        if not posts_path or not extensions:
            raise ConfigurationError("文章目录和扩展名不能为空")
        if "\\" in posts_path or any(part in {".", ".."} for part in PurePosixPath(posts_path).parts):
            raise ConfigurationError("QEXO_POSTS_PATH 不是安全的仓库目录")

        return cls(token, repository, branch, posts_path, extensions)


class GitHubContentClient:
    api_url = "https://api.github.com"

    def __init__(self, config=None, session=None):
        self.config = config or GitHubConfig.from_environment()
        self.session = session or requests.Session()

    @property
    def headers(self):
        return {
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {self.config.token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "Qexo-Stateless-Editor",
        }

    def _request(self, method, path, expected, payload=None, response_type=dict):
        try:
            response = self.session.request(
                method,
                f"{self.api_url}{path}",
                headers=self.headers,
                json=payload,
                timeout=15,
            )
        except requests.RequestException as exc:
            raise GitHubError("无法连接 GitHub，请稍后重试") from exc

        if response.status_code not in expected:
            try:
                error_data = response.json()
                detail = error_data.get("message", "") if isinstance(error_data, dict) else ""
            except ValueError:
                detail = ""
            detail = str(detail).replace("\n", " ")[:300]
            suffix = f"：{detail}" if detail else ""
            raise GitHubError(f"GitHub API 返回 {response.status_code}{suffix}")
        if response.status_code == 204:
            return {}
        try:
            data = response.json()
        except ValueError as exc:
            raise GitHubError("GitHub 返回了无法解析的数据") from exc
        if not isinstance(data, response_type):
            raise GitHubError("GitHub 返回了意外的数据格式")
        return data

    def normalize_article_path(self, path):
        raw_path = (path or "").strip()
        if not raw_path or raw_path.startswith(("/", "\\")) or "\\" in raw_path:
            raise InvalidArticlePath("文章路径无效")
        if any(ord(character) < 32 for character in raw_path):
            raise InvalidArticlePath("文章路径不能包含控制字符")
        pure_path = PurePosixPath(raw_path)
        if any(part in {"", ".", ".."} for part in pure_path.parts):
            raise InvalidArticlePath("文章路径不能包含 . 或 ..")
        normalized = pure_path.as_posix()
        if not normalized.lower().endswith(self.config.extensions):
            raise InvalidArticlePath("文章扩展名必须是 " + "、".join(self.config.extensions))
        return normalized

    def _full_path(self, article_path):
        normalized = self.normalize_article_path(article_path)
        return f"{self.config.posts_path}/{normalized}"

    def list_articles(self, query=""):
        branch = quote(self.config.branch, safe="")
        data = self._request(
            "GET",
            f"/repos/{self.config.repository}/git/trees/{branch}?recursive=1",
            {200},
        )
        if data.get("truncated"):
            raise GitHubError("仓库文件树过大，GitHub 返回了不完整结果")

        prefix = self.config.posts_path + "/"
        lowered_query = query.strip().lower()
        articles = []
        for item in data.get("tree", []):
            full_path = item.get("path", "")
            if item.get("type") != "blob" or not full_path.startswith(prefix):
                continue
            article_path = full_path[len(prefix):]
            if not article_path.lower().endswith(self.config.extensions):
                continue
            if lowered_query and lowered_query not in article_path.lower():
                continue
            articles.append({
                "path": article_path,
                "name": PurePosixPath(article_path).stem,
                "size": item.get("size", 0),
                "sha": item.get("sha", ""),
            })
        return sorted(articles, key=lambda item: item["path"].lower())

    def get_article(self, article_path):
        full_path = quote(self._full_path(article_path), safe="/")
        branch = quote(self.config.branch, safe="")
        data = self._request(
            "GET",
            f"/repos/{self.config.repository}/contents/{full_path}?ref={branch}",
            {200},
        )
        if data.get("type") != "file" or data.get("encoding") != "base64":
            raise GitHubError("目标不是可编辑的文本文件")
        try:
            encoded_content = "".join(data.get("content", "").split())
            content = base64.b64decode(encoded_content, validate=True).decode("utf-8")
        except (ValueError, UnicodeDecodeError) as exc:
            raise GitHubError("文章不是有效的 UTF-8 文本") from exc
        return {"path": self.normalize_article_path(article_path), "sha": data.get("sha", ""), "content": content}

    def get_article_last_modified(self, article_path):
        """Return the latest commit date for an article on the configured branch."""
        full_path = quote(self._full_path(article_path), safe="")
        branch = quote(self.config.branch, safe="")
        data = self._request(
            "GET",
            f"/repos/{self.config.repository}/commits?sha={branch}&path={full_path}&per_page=1",
            {200},
            response_type=list,
        )
        if not data:
            return ""
        commit = data[0].get("commit", {}) if isinstance(data[0], dict) else {}
        committer = commit.get("committer", {}) if isinstance(commit, dict) else {}
        author = commit.get("author", {}) if isinstance(commit, dict) else {}
        return str(committer.get("date") or author.get("date") or "")

    def save_article(self, article_path, content, sha="", message=""):
        normalized = self.normalize_article_path(article_path)
        full_path = quote(self._full_path(normalized), safe="/")
        commit_message = message.strip() or f"Update {normalized} from Qexo"
        payload = {
            "message": commit_message[:200],
            "content": base64.b64encode(content.encode("utf-8")).decode("ascii"),
            "branch": self.config.branch,
        }
        if sha:
            payload["sha"] = sha
        return self._request(
            "PUT",
            f"/repos/{self.config.repository}/contents/{full_path}",
            {200, 201},
            payload,
        )

    def delete_article(self, article_path, sha, message=""):
        normalized = self.normalize_article_path(article_path)
        if not sha:
            raise InvalidArticlePath("删除文章必须提供当前 SHA")
        full_path = quote(self._full_path(normalized), safe="/")
        commit_message = message.strip() or f"Delete {normalized} from Qexo"
        payload = {
            "message": commit_message[:200],
            "sha": sha,
            "branch": self.config.branch,
        }
        return self._request(
            "DELETE",
            f"/repos/{self.config.repository}/contents/{full_path}",
            {200},
            payload,
        )
