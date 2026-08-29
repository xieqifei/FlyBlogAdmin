import json
import re
import unicodedata
from datetime import date, datetime

import yaml


MANAGED_FIELDS = ("title", "date", "tags", "categories", "cover", "description")
FIELD_NAME_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_-]*$")
FIELD_PATTERN = re.compile(r"^([A-Za-z_][A-Za-z0-9_-]*):(?:\s*(.*))?$")


class _FrontMatterDumper(yaml.SafeDumper):
    def ignore_aliases(self, data):
        return True


class _QuotedString(str):
    pass


def _represent_quoted_string(dumper, value):
    return dumper.represent_scalar("tag:yaml.org,2002:str", value, style='"')


_FrontMatterDumper.add_representer(_QuotedString, _represent_quoted_string)


def split_front_matter(content):
    """Split a Markdown document while preserving all body text."""
    normalized = (content or "").replace("\r\n", "\n").replace("\r", "\n")
    if normalized.startswith("\ufeff"):
        normalized = normalized[1:]
    lines = normalized.splitlines()
    if not lines or lines[0].strip() not in {"---", ";;;"}:
        return "", normalized
    delimiter = lines[0].strip()
    closing_delimiters = {delimiter, "..."} if delimiter == "---" else {delimiter}
    for index, line in enumerate(lines[1:], start=1):
        if line.strip() in closing_delimiters:
            body = "\n".join(lines[index + 1:]).lstrip("\n")
            return "\n".join(lines[1:index]), body
    return "", normalized


def _plain_value(value):
    if isinstance(value, datetime):
        return value.isoformat(sep=" ")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, list):
        return [_plain_value(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _plain_value(item) for key, item in value.items()}
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _mapping_from_header(header):
    if not (header or "").strip():
        return {}
    try:
        loaded = yaml.safe_load(header)
    except yaml.YAMLError:
        loaded = None
    if not isinstance(loaded, dict):
        # Keep legacy Hexo template values such as ``{{ date }}`` visible even
        # though they are not valid standalone YAML values.
        lines = header.splitlines()
        starts = []
        for index, line in enumerate(lines):
            match = FIELD_PATTERN.match(line)
            if match and not line[:1].isspace():
                starts.append((index, match.group(1), match.group(2) or ""))
        loaded = {}
        for position, (start, key, inline) in enumerate(starts):
            end = starts[position + 1][0] if position + 1 < len(starts) else len(lines)
            snippet = "\n".join(lines[start:end])
            try:
                parsed = yaml.safe_load(snippet)
            except yaml.YAMLError:
                parsed = None
            if isinstance(parsed, dict) and key in parsed:
                loaded[key] = parsed[key]
            else:
                continuation = "\n".join(line.lstrip() for line in lines[start + 1:end])
                loaded[key] = "\n".join(part for part in (inline, continuation) if part)
    return {str(key): _plain_value(value) for key, value in loaded.items()}


def _list_value(value):
    if value in (None, ""):
        return []
    return value if isinstance(value, list) else [value]


def _display_value(value):
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    return str(value)


def list_field_text(values):
    return "\n".join(_display_value(value) for value in _list_value(values))


def parse_article(content):
    header, body = split_front_matter(content)
    values = _mapping_from_header(header)
    metadata = {
        field: _list_value(values.get(field)) if field in {"tags", "categories"}
        else _display_value(values.get(field, ""))
        for field in MANAGED_FIELDS
    }
    custom_fields = [
        {"name": key, "value": _display_value(value)}
        for key, value in values.items()
        if key not in MANAGED_FIELDS
    ]
    return {
        "front_matter": header,
        "body": body,
        "tags_text": list_field_text(metadata["tags"]),
        "categories_text": list_field_text(metadata["categories"]),
        "custom_fields": custom_fields,
        **metadata,
    }


def _parse_form_value(value):
    text = str(value or "").strip()
    if not text:
        return ""
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        return text


def split_list(value):
    """Parse one-value-per-line fields while retaining nested JSON values."""
    text = str(value or "").strip()
    if not text:
        return []
    items = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith(("[", "{")):
            items.append(_parse_form_value(stripped))
        else:
            items.extend(
                _parse_form_value(item)
                for item in re.split(r"[,，]", stripped)
                if item.strip()
            )
    return items


def parse_custom_fields(names, values):
    fields = {}
    for name, value in zip(names, values):
        key = str(name or "").strip()
        if not key:
            continue
        if key in MANAGED_FIELDS or not FIELD_NAME_PATTERN.fullmatch(key):
            raise ValueError(f"无效或重复的元数据字段：{key}")
        if key in fields:
            raise ValueError(f"元数据字段不能重复：{key}")
        fields[key] = _parse_form_value(value)
    return fields


def build_article(original_header, body, metadata, custom_fields=None):
    """Build YAML front matter without dropping legacy or structured fields."""
    def quote_strings(value):
        if isinstance(value, str):
            return _QuotedString(value)
        if isinstance(value, list):
            return [quote_strings(item) for item in value]
        if isinstance(value, dict):
            return {key: quote_strings(item) for key, item in value.items()}
        return value

    original = _mapping_from_header(original_header)
    if custom_fields is None:
        result = {key: value for key, value in original.items() if key not in MANAGED_FIELDS}
    else:
        result = dict(custom_fields)

    for key in MANAGED_FIELDS:
        value = metadata.get(key)
        if value not in (None, "", []):
            result[key] = quote_strings(value)

    header = yaml.dump(
        result,
        Dumper=_FrontMatterDumper,
        allow_unicode=True,
        sort_keys=False,
        default_flow_style=False,
    ).rstrip()
    return f"---\n{header}\n---\n\n{body or ''}"


def article_path_from_title(title):
    normalized = unicodedata.normalize("NFKC", title or "").strip().lower()
    characters = []
    pending_separator = False
    for character in normalized:
        if character.isalnum():
            if pending_separator and characters:
                characters.append("-")
            characters.append(character)
            pending_separator = False
        else:
            pending_separator = True
    slug = "".join(characters).strip("-")[:80].rstrip("-")
    if not slug:
        slug = f"article-{date.today().isoformat()}"
    return f"{slug}.md"
