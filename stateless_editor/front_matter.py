import json
import re
import unicodedata
from datetime import date


MANAGED_FIELDS = ("title", "date", "tags", "categories", "cover", "description")
FIELD_PATTERN = re.compile(r"^([A-Za-z_][A-Za-z0-9_-]*):(?:\s*(.*))?$")


def split_front_matter(content):
    """Split a Markdown document while preserving the original YAML header."""
    normalized = (content or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = normalized.splitlines()
    if not lines or lines[0].strip() != "---":
        return "", normalized
    for index, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            return "\n".join(lines[1:index]), "\n".join(lines[index + 1:]).lstrip("\n")
    return "", normalized


def _field_blocks(header):
    lines = header.splitlines()
    blocks = []
    starts = []
    for index, line in enumerate(lines):
        match = FIELD_PATTERN.match(line)
        if match and not line[:1].isspace():
            starts.append((index, match.group(1), match.group(2) or ""))
    for position, (start, key, inline) in enumerate(starts):
        end = starts[position + 1][0] if position + 1 < len(starts) else len(lines)
        blocks.append((start, end, key, inline, lines[start:end]))
    return lines, blocks


def _unquote(value):
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        if value[0] == '"':
            try:
                return json.loads(value)
            except (ValueError, TypeError):
                pass
        return value[1:-1].replace("''", "'")
    return value


def _list_value(inline, block):
    inline = inline.strip()
    if inline.startswith("[") and inline.endswith("]"):
        return [_unquote(item) for item in inline[1:-1].split(",") if item.strip()]
    values = []
    for line in block[1:]:
        stripped = line.strip()
        if stripped.startswith("-"):
            value = _unquote(stripped[1:].strip())
            if value:
                values.append(value)
    if inline:
        values.append(_unquote(inline))
    return values


def parse_article(content):
    header, body = split_front_matter(content)
    metadata = {field: [] if field in {"tags", "categories"} else "" for field in MANAGED_FIELDS}
    _, blocks = _field_blocks(header)
    for _, _, key, inline, block in blocks:
        if key not in metadata:
            continue
        if key in {"tags", "categories"}:
            metadata[key] = _list_value(inline, block)
        else:
            metadata[key] = _unquote(inline)
    return {"front_matter": header, "body": body, **metadata}


def _quoted(value):
    return json.dumps(str(value).strip(), ensure_ascii=False)


def build_article(original_header, body, metadata):
    """Update managed Hexo fields and leave custom front-matter fields intact."""
    lines, blocks = _field_blocks(original_header or "")
    managed_ranges = {
        index
        for start, end, key, _, _ in blocks
        if key in MANAGED_FIELDS
        for index in range(start, end)
    }
    preserved = [line for index, line in enumerate(lines) if index not in managed_ranges]
    while preserved and not preserved[-1].strip():
        preserved.pop()

    generated = [f"title: {_quoted(metadata.get('title', ''))}"]
    if metadata.get("date"):
        generated.append(f"date: {_quoted(metadata['date'])}")
    for key in ("tags", "categories"):
        values = metadata.get(key) or []
        if values:
            generated.append(f"{key}:")
            generated.extend(f"  - {_quoted(value)}" for value in values)
    for key in ("cover", "description"):
        if metadata.get(key):
            generated.append(f"{key}: {_quoted(metadata[key])}")

    header = "\n".join([*preserved, *generated])
    return f"---\n{header}\n---\n\n{(body or '').lstrip()}"


def split_list(value):
    return [item.strip() for item in re.split(r"[,，\n]", value or "") if item.strip()]


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
