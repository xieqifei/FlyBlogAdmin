import os

import requests


class LLMConfigurationError(Exception):
    pass


class LLMError(Exception):
    def __init__(self, message, status_code=None):
        super().__init__(message)
        self.status_code = status_code


class LLMClient:
    def __init__(self, api_key=None, model=None, base_url=None, api_style=None, session=None):
        self.api_key = (api_key if api_key is not None else os.environ.get("LLM_API_KEY", "")).strip()
        self.model = (model if model is not None else os.environ.get("LLM_MODEL", "")).strip()
        self.base_url = (base_url if base_url is not None else os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1")).strip().rstrip("/")
        self.api_style = (api_style if api_style is not None else os.environ.get("LLM_API_STYLE", "auto")).strip().lower()
        self.session = session or requests.Session()
        if not self.api_key or not self.model:
            raise LLMConfigurationError("AI 尚未配置，请设置 LLM_API_KEY 和 LLM_MODEL")
        if not self.base_url.startswith(("https://", "http://")):
            raise LLMConfigurationError("LLM_BASE_URL 必须是 HTTP(S) 地址")
        if self.api_style not in {"auto", "chat", "responses"}:
            raise LLMConfigurationError("LLM_API_STYLE 必须是 auto、chat 或 responses")

    def optimize(self, content, instruction):
        if self.api_style == "chat":
            return self._call_chat(content, instruction)
        if self.api_style == "responses":
            return self._call_responses(content, instruction)
        try:
            return self._call_chat(content, instruction)
        except LLMError as exc:
            if exc.status_code not in {400, 404}:
                raise
            return self._call_responses(content, instruction)

    def _request(self, endpoint, payload):
        try:
            response = self.session.post(
                f"{self.base_url}/{endpoint}",
                headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                json=payload,
                timeout=60,
            )
        except requests.RequestException as exc:
            raise LLMError("无法连接 AI 服务，请稍后重试") from exc
        if response.status_code not in {200, 201}:
            raise LLMError(f"AI 服务返回 {response.status_code}", response.status_code)
        try:
            return response.json()
        except ValueError as exc:
            raise LLMError("AI 服务返回了无法解析的数据") from exc

    def _extract_responses_text(self, data):
        text = data.get("output_text", "") if isinstance(data, dict) else ""
        if not text and isinstance(data, dict):
            for item in data.get("output", []):
                if not isinstance(item, dict) or item.get("type") != "message":
                    continue
                for part in item.get("content", []):
                    if isinstance(part, dict) and part.get("type") == "output_text":
                        text += part.get("text", "")
        return text

    def _extract_chat_text(self, data):
        text = ""
        if not isinstance(data, dict):
            return text
        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            return text
        if isinstance(content, str):
            text = content
        elif isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and part.get("type") == "text":
                    text += part.get("text", "")
        return text

    def _call_chat(self, content, instruction):
        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "你是博客文章编辑助手。只输出修改后的 Markdown 正文，不要添加解释、代码围栏或 Front Matter。"
                        "保留原文事实、链接、图片、代码块和标题层级；除非用户明确要求，不要杜撰信息。"
                    ),
                },
                {"role": "user", "content": f"编辑要求：{instruction}\n\n待编辑内容：\n{content}"},
            ],
            "max_tokens": 6000,
            "temperature": 0.4,
        }
        data = self._request("chat/completions", payload)
        text = self._extract_chat_text(data).strip()
        if not text:
            raise LLMError("AI 未返回可用文本")
        return text

    def _call_responses(self, content, instruction):
        payload = {
            "model": self.model,
            "instructions": (
                "你是博客文章编辑助手。只输出修改后的 Markdown 正文，不要添加解释、代码围栏或 Front Matter。"
                "保留原文事实、链接、图片、代码块和标题层级；除非用户明确要求，不要杜撰信息。"
            ),
            "input": f"编辑要求：{instruction}\n\n待编辑内容：\n{content}",
            "max_output_tokens": 6000,
            "store": False,
        }
        data = self._request("responses", payload)
        text = self._extract_responses_text(data).strip()
        if not text:
            raise LLMError("AI 未返回可用文本")
        return text
