"""In-memory article catalog, full-text search, and sparse vector indexing."""

import html
import hashlib
import math
import os
import posixpath
import re
import threading
import time
import unicodedata
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import PurePosixPath
from urllib.parse import unquote, urlsplit

from django.core.cache import cache

from .front_matter import parse_article


_CACHE = {}
_CACHE_LOCK = threading.Lock()
_WORD_PATTERN = re.compile(r"[a-z0-9]+(?:[-_][a-z0-9]+)*")
_CJK_PATTERN = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]+")
_MARKDOWN_LINK = re.compile(r"!?\[([^]]*)\]\([^)]*\)")
_MARKDOWN_LINK_TARGET = re.compile(
    r"(?<!!)\[[^]\n]*\]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))",
)
_WIKI_LINK = re.compile(r"!?\[\[([^]\n]+)\]\]")
_EXTERNAL_LINK = re.compile(r"^(?:[a-z][a-z0-9+.-]*:|//)", re.IGNORECASE)
_HTML_TAG = re.compile(r"<[^>]+>")
_FENCE = re.compile(r"```[^\n]*\n?(.*?)```", re.DOTALL)
_SPACE = re.compile(r"\s+")
_EDITED_FIELD_NAMES = {"lastmod", "modified", "updated_at", "last_modified"}


def _normalized_text(value):
    return unicodedata.normalize("NFKC", str(value or "")).casefold()


def _labels(values):
    """Flatten structured taxonomies into stable, human-readable labels."""
    result = []

    def append(value):
        if isinstance(value, (list, tuple)):
            for item in value:
                append(item)
        elif isinstance(value, dict):
            for key in value:
                append(key)
        elif value not in (None, ""):
            label = str(value).strip()
            if label and label not in result:
                result.append(label)

    append(values)
    return result


def markdown_text(value):
    """Produce searchable plain text without executing or rendering Markdown."""
    text = str(value or "")
    text = _FENCE.sub(lambda match: match.group(1), text)
    text = _MARKDOWN_LINK.sub(lambda match: match.group(1), text)
    text = _HTML_TAG.sub(" ", text)
    text = re.sub(r"[`*_~>#|]", " ", text)
    return _SPACE.sub(" ", html.unescape(text)).strip()


def article_links(value):
    """Extract safe internal Markdown and Obsidian-style wiki link targets."""
    text = str(value or "")
    links = []
    seen = set()

    def append(target, kind):
        target = html.unescape(str(target or "")).strip()
        if not target or target.startswith("#") or _EXTERNAL_LINK.match(target):
            return
        key = (target, kind)
        if key not in seen:
            seen.add(key)
            links.append({"target": target, "format": kind})

    for match in _WIKI_LINK.finditer(text):
        target = match.group(1).split("|", 1)[0].split("#", 1)[0].strip()
        append(target, "wiki")
    for match in _MARKDOWN_LINK_TARGET.finditer(text):
        append(match.group(1) or match.group(2), "markdown")
    return links


def tokenize(value):
    """Tokenize Latin words and Chinese uni/bi-grams for local vector search."""
    text = _normalized_text(value)
    tokens = _WORD_PATTERN.findall(text)
    for group in _CJK_PATTERN.findall(text):
        characters = list(group)
        tokens.extend(characters)
        tokens.extend(
            characters[index] + characters[index + 1]
            for index in range(len(characters) - 1)
        )
    return tokens


def _edited_date(parsed):
    if parsed.get("updated"):
        return str(parsed["updated"])
    for field in parsed.get("custom_fields", []):
        if str(field.get("name", "")).casefold() in _EDITED_FIELD_NAMES:
            value = str(field.get("value", "")).strip()
            if value:
                return value
    return ""


def article_document(entry, content):
    parsed = parse_article(content)
    title = str(parsed.get("title") or PurePosixPath(entry["path"]).stem)
    categories = _labels(parsed.get("categories", []))
    tags = _labels(parsed.get("tags", []))
    description = markdown_text(parsed.get("description", ""))
    raw_body = str(parsed.get("body", "") or "")
    body = markdown_text(raw_body)
    searchable = " ".join((entry["path"], title, " ".join(categories), " ".join(tags), description, body))
    weighted = " ".join((entry["path"],) * 2 + (title,) * 4 + tuple(categories) * 3 + tuple(tags) * 3 + (description,) * 2 + (body,))
    return {
        "path": entry["path"],
        "sha": entry.get("sha", ""),
        "size": entry.get("size", 0),
        "title": title,
        "categories": categories,
        "tags": tags,
        "created_at": str(parsed.get("date", "")),
        "updated_at": _edited_date(parsed),
        "description": description,
        "excerpt": description or body[:180],
        "metadata_error": False,
        "_links": article_links(raw_body),
        "_body": body,
        "_normalized": _normalized_text(searchable),
        "_terms": Counter(tokenize(weighted)),
    }


def _document_cache_key(client, entry):
    sha = str(entry.get("sha") or "").strip()
    if not sha:
        return ""
    identity = "\0".join((
        client.config.repository,
        client.config.branch,
        entry["path"],
        sha,
    ))
    return "blog-admin:article-document:" + hashlib.sha256(identity.encode()).hexdigest()


def _load_document(client, entry, refresh=False):
    cache_key = _document_cache_key(client, entry)
    cached = None if refresh or not cache_key else cache.get(cache_key)
    if isinstance(cached, dict):
        return {**cached, "path": entry["path"], "sha": entry.get("sha", ""), "size": entry.get("size", 0)}
    metadata_error = False
    try:
        if "content" in entry:
            content = entry["content"]
        elif entry.get("sha"):
            content = client.get_article_blob(entry["sha"], entry["path"])["content"]
        else:
            content = client.get_article(entry["path"])["content"]
        document = article_document(entry, content)
    except (KeyError, TypeError, UnicodeError) as exc:
        raise ValueError(f"无法解析文章 {entry.get('path', '')}") from exc
    except Exception as exc:
        # GitHub failures for one article should not hide the rest of the list.
        if exc.__class__.__name__ not in {"GitHubError", "InvalidArticlePath"}:
            raise
        document = article_document(entry, "")
        metadata_error = True
    if not document["updated_at"]:
        try:
            document["updated_at"] = str(client.get_article_last_modified(entry["path"]) or "").strip()
        except (AttributeError, TypeError):
            metadata_error = True
        except Exception as exc:
            if exc.__class__.__name__ not in {"GitHubError", "InvalidArticlePath"}:
                raise
            metadata_error = True
    if not document["updated_at"]:
        document["updated_at"] = document["created_at"]
    document["metadata_error"] = metadata_error
    if cache_key and not metadata_error:
        cache.set(cache_key, document, _cache_seconds())
    return document


def load_documents(client, entries, refresh=False):
    entries = list(entries)
    if not entries:
        return []
    with ThreadPoolExecutor(max_workers=min(8, len(entries))) as executor:
        return list(executor.map(
            lambda entry: _load_document(client, entry, refresh=refresh),
            entries,
        ))


def public_article(document, score=None):
    result = {
        key: document[key]
        for key in (
            "path", "sha", "size", "title", "categories", "tags",
            "created_at", "updated_at", "description", "excerpt",
            "metadata_error",
        )
    }
    if score is not None:
        result["score"] = round(score, 6)
    return result


class ArticleCatalog:
    def __init__(self, documents):
        self.documents = documents
        document_count = max(len(documents), 1)
        frequencies = Counter()
        for document in documents:
            frequencies.update(document["_terms"].keys())
        self.idf = {
            term: math.log((document_count + 1) / (count + 1)) + 1
            for term, count in frequencies.items()
        }
        for document in documents:
            vector = {
                term: (1 + math.log(count)) * self.idf[term]
                for term, count in document["_terms"].items()
            }
            document["_vector"] = vector
            document["_norm"] = math.sqrt(sum(value * value for value in vector.values())) or 1

    def search(self, query):
        normalized_query = _normalized_text(query).strip()
        if not normalized_query:
            return [(document, None) for document in self.documents]
        query_terms = Counter(tokenize(normalized_query))
        query_vector = {
            term: (1 + math.log(count)) * self.idf.get(term, 1)
            for term, count in query_terms.items()
        }
        query_norm = math.sqrt(sum(value * value for value in query_vector.values())) or 1
        results = []
        for document in self.documents:
            dot_product = sum(
                value * document["_vector"].get(term, 0)
                for term, value in query_vector.items()
            )
            cosine = dot_product / (query_norm * document["_norm"])
            title = _normalized_text(document["title"])
            taxonomies = _normalized_text(" ".join(document["categories"] + document["tags"]))
            description = _normalized_text(document["description"])
            exact = 0
            if normalized_query in title:
                exact += 6
            if normalized_query in taxonomies:
                exact += 4
            if normalized_query in description:
                exact += 3
            if normalized_query in document["_normalized"]:
                exact += 2
            score = exact + cosine
            if score > 0:
                results.append((document, score))
        return sorted(
            results,
            key=lambda item: (-item[1], item[0]["title"].casefold(), item[0]["path"].casefold()),
        )

    @staticmethod
    def _link_key(value):
        value = unquote(str(value or "")).strip().replace("\\", "/")
        if not value:
            return ""
        try:
            value = urlsplit(value).path
        except ValueError:
            value = value.split("?", 1)[0].split("#", 1)[0]
        value = value.strip().strip("/")
        return _normalized_text(value)

    @classmethod
    def _document_link_keys(cls, document):
        path = str(document["path"])
        path_without_suffix = str(PurePosixPath(path).with_suffix(""))
        basename = PurePosixPath(path).name
        stem = PurePosixPath(path).stem
        title = str(document["title"])
        title_slug = re.sub(r"[^\w\-]+", "-", _normalized_text(title)).strip("-")
        return {
            key for key in (
                cls._link_key(path),
                cls._link_key(path_without_suffix),
                cls._link_key(basename),
                cls._link_key(stem),
                cls._link_key(title),
                cls._link_key(title_slug),
            ) if key
        }

    def _link_index(self):
        index = {}
        for document in self.documents:
            for key in self._document_link_keys(document):
                index.setdefault(key, document)
        return index

    def _resolve_link(self, source, target, index):
        raw_target = unquote(str(target or "")).strip()
        try:
            target_path = urlsplit(raw_target).path
        except ValueError:
            target_path = raw_target.split("?", 1)[0].split("#", 1)[0]
        target_path = target_path.replace("\\", "/")
        candidates = [target_path]
        if target_path and not target_path.startswith("/"):
            candidates.insert(0, posixpath.normpath(
                posixpath.join(str(PurePosixPath(source["path"]).parent), target_path),
            ))
        for candidate in candidates:
            keys = [self._link_key(candidate)]
            suffix = PurePosixPath(candidate).suffix.casefold()
            if suffix in {".md", ".markdown", ".html", ".htm"}:
                keys.append(self._link_key(str(PurePosixPath(candidate).with_suffix(""))))
            keys.extend((
                self._link_key(PurePosixPath(candidate).name),
                self._link_key(PurePosixPath(candidate).stem),
            ))
            for key in keys:
                if key and key in index:
                    return index[key]
        return None

    def graph(self, focus="", depth=1):
        nodes = []
        edges = []
        seen = set()
        edge_keys = set()
        link_index = self._link_index()

        def add_node(node):
            if node["id"] not in seen:
                seen.add(node["id"])
                nodes.append(node)

        for document in self.documents:
            article_id = "article:" + document["path"]
            add_node({
                "id": article_id,
                "type": "article",
                "label": document["title"],
                "path": document["path"],
            })
            for kind, labels in (("category", document["categories"]), ("tag", document["tags"])):
                for label in labels:
                    taxonomy_id = f"{kind}:{label.casefold()}"
                    add_node({"id": taxonomy_id, "type": kind, "label": label})
                    edge_key = (article_id, taxonomy_id, kind)
                    if edge_key not in edge_keys:
                        edge_keys.add(edge_key)
                        edges.append({"source": article_id, "target": taxonomy_id, "type": kind})
            for link in document.get("_links", []):
                target = self._resolve_link(document, link.get("target"), link_index)
                if not target or target["path"] == document["path"]:
                    continue
                target_id = "article:" + target["path"]
                edge_key = (article_id, target_id, "link")
                if edge_key not in edge_keys:
                    edge_keys.add(edge_key)
                    edges.append({
                        "source": article_id,
                        "target": target_id,
                        "type": "link",
                        "directed": True,
                        "format": link.get("format", "markdown"),
                    })

        degree = Counter()
        for edge in edges:
            degree[edge["source"]] += 1
            degree[edge["target"]] += 1
        for node in nodes:
            node["degree"] = degree[node["id"]]

        focus_document = None
        if focus:
            focus_document = link_index.get(self._link_key(focus))
        focus_id = "article:" + focus_document["path"] if focus_document else ""
        if focus_id:
            adjacency = {}
            for edge in edges:
                adjacency.setdefault(edge["source"], set()).add(edge["target"])
                adjacency.setdefault(edge["target"], set()).add(edge["source"])
            visible = {focus_id}
            frontier = {focus_id}
            for _ in range(max(1, min(int(depth), 3))):
                frontier = {
                    neighbor
                    for node_id in frontier
                    for neighbor in adjacency.get(node_id, ())
                    if neighbor not in visible
                }
                visible.update(frontier)
            nodes = [node for node in nodes if node["id"] in visible]
            edges = [
                edge for edge in edges
                if edge["source"] in visible and edge["target"] in visible
            ]
        return {
            "nodes": nodes,
            "edges": edges,
            "scope": "local" if focus_id else "global",
            "focus": focus_id,
        }


def _cache_seconds():
    try:
        return max(0, min(int(os.environ.get("SEARCH_CACHE_SECONDS", "300")), 3600))
    except ValueError:
        return 300


def _cache_key(config):
    return (config.repository, config.branch, config.posts_path, config.extensions)


def get_catalog(client, refresh=False):
    key = _cache_key(client.config)
    ttl = _cache_seconds()
    now = time.monotonic()
    if not refresh and ttl:
        with _CACHE_LOCK:
            cached = _CACHE.get(key)
            if cached and now - cached[0] < ttl:
                return cached[1]
    catalog = ArticleCatalog(load_documents(client, client.list_articles(), refresh=refresh))
    if ttl:
        with _CACHE_LOCK:
            _CACHE[key] = (now, catalog)
    return catalog


def invalidate_catalog(config=None):
    with _CACHE_LOCK:
        if config is None:
            _CACHE.clear()
        else:
            _CACHE.pop(_cache_key(config), None)
