# Qexo
[![GitHub Release](https://img.shields.io/github/release/qexo/qexo.svg?style=for-the-badge&logo=Qase&color=005AA4)](https://github.com/qexo/qexo/releases/latest)
[![Docker Pulls](https://img.shields.io/docker/pulls/abudulin/qexo.svg?style=for-the-badge&logo=docker&logoColor=fff&color=005AA4&label=docker.io%20pulls)](https://hub.docker.com/r/abudulin/qexo)
[![GHCR](https://img.shields.io/badge/ghcr.io-qexo%2Fqexo-blue?style=for-the-badge&logo=github&logoColor=fff&color=005AA4&label=ghcr.io)](https://github.com/Qexo/Qexo/pkgs/container/qexo)<br>
[![Contributors](https://img.shields.io/github/contributors-anon/qexo/qexo.svg?style=flat-square&logo=Qase&color=005AA4)](https://github.com/qexo/qexo/graphs/contributors)
[![Forks](https://img.shields.io/github/forks/qexo/qexo.svg?style=flat-square&logo=github&logoColor=fff&color=005AA4)](https://github.com/qexo/qexo/network/members)
[![Stars](https://img.shields.io/github/stars/qexo/qexo.svg?style=flat-square&logo=github&logoColor=fff&color=005AA4)](https://github.com/qexo/qexo/stargazers)
[![Issues Open](https://img.shields.io/github/issues/qexo/qexo.svg?style=flat-square&logo=github&logoColor=fff&color=005AA4&cacheSeconds=300)](https://github.com/qexo/qexo/issues)
[![Issues Closed](https://img.shields.io/github/issues-closed/qexo/qexo.svg?style=flat-square&logo=github&logoColor=fff&color=005AA4&cacheSeconds=300)](https://github.com/qexo/qexo/issues?q=is%3Aissue+is%3Aclosed)<br>
[![GPL-3.0 Licensed](https://img.shields.io/github/license/qexo/qexo.svg?style=flat-square&logo=Qase&color=e97536&cacheSeconds=14400)](https://github.com/qexo/qexo/blob/main/LICENSE.txt)
[![GitHub Discussions](https://img.shields.io/github/discussions/qexo/qexo?style=flat-square&logo=github&logoColor=fff&color=953B00&cacheSeconds=300)](https://github.com/qexo/qexo/discussions)
[![Docker Release](https://github.com/Qexo/Qexo/actions/workflows/docker-image-release.yml/badge.svg)](https://github.com/Qexo/Qexo/actions/workflows/docker-image-release.yml)
[![Docker Testing](https://github.com/Qexo/Qexo/actions/workflows/docker-image-testing.yml/badge.svg)](https://github.com/Qexo/Qexo/actions/workflows/docker-image-testing.yml)

Qexo 是一个快速、强大、美观的在线 静态博客编辑器。使用 GPL3.0 开源协议。支持包括且不限于在 Vercel 等平台部署, 为您的静态博客添加动态的元素

**Qexo** is a fast, powerful and beautiful online **static blog editor**. Uses the GPL3.0 **Open Source** license. Support includes and is not limited to deployment on platforms such as **Vercel**, adding **dynamic** elements to your static blogs
![](https://s2.loli.net/2024/07/19/r1XJPHnYANKbcRl.png)

[请阅读文档](https://oplog.cn/qexo/)

[Please read Wiki first](https://oplog.cn/qexo/en/)
## Features 特性

- **Article Management ~ New Interface**

  Version 3.0 of Qexo redesigned the post editing page, you can edit posts more elegantly.

  Support multiple image uploading, uploading is just a click away!
![](https://s2.loli.net/2024/07/19/q3LlJutFDCvpbMh.png)
- **Smaller than a sparrow ~ complete in every way** 

  - Modularized Architecture
  - Supports multiple Hexo, Hugo, Valaxy hosts Github, Gitlab, Local
  - Multiple graph bed protocols support Github, S3, FTP, remote APIs
  - Markdown syntax + multiple editing interfaces, what you see is what you get.
  - New interface: Night/Day with one click
  - Multi-format push Bark, Telegram, Pushdeer, Wechat...
  - reCaptcha Spam Prevention
  - Links Front-end application, one-click access
  - Automatic update Easy and convenient, keep the latest
  - Customized Fields / Site Statistics / Page Management / Configuration Editing
  - Comment Notification / Image Upload / Logo Generation / API Expansion

## 无数据库模式

此分支固定运行无数据库 GitHub 文章编辑器，不加载 Django 用户、Session、缓存、Passkeys 或任何 Qexo 动态功能数据表，只提供单管理员登录和文章的列表、新建、编辑、删除。MySQL、PostgreSQL、MongoDB、PlanetScale 及 `configs.py` 均不再需要；旧数据库环境变量即使残留也不会被读取。

首次部署不需要模式开关。若必需变量未齐全，访问网站会进入 `/setup/` 配置引导页，可直接生成签名密钥和密码哈希，并查看 GitHub Token、仓库、域名等变量的获取步骤。

必需环境变量：

| 名称 | 说明 |
| --- | --- |
| `QEXO_SECRET_KEY` | 用于签名登录 Cookie 的长期随机密钥；轮换后所有登录失效 |
| `ADMIN_USERNAME` | 管理员用户名 |
| `ADMIN_PASSWORD_HASH` | 推荐：由 `/setup/` 生成的 Django 格式密码哈希 |
| `ADMIN_PASSWORD` | 可选替代项：明文密码；与哈希同时设置时优先使用哈希 |
| `QEXO_GITHUB_TOKEN` | 仅授予目标仓库 Contents 读写权限的 GitHub Token |
| `QEXO_GITHUB_REPOSITORY` | 目标仓库，格式为 `owner/repository` |
| `QEXO_GITHUB_BRANCH` | 写入分支，例如 `main` |
| `QEXO_POSTS_PATH` | 文章目录，例如 Hexo 的 `source/_posts` |
| `DOMAINS` | 允许访问的域名 JSON 列表，例如 `["editor.example.com"]` |
| `QEXO_LLM_API_KEY` | 可选：AI 服务 API Key |
| `QEXO_LLM_MODEL` | 可选：AI 模型名称 |
| `QEXO_LLM_BASE_URL` | 可选：OpenAI 兼容 API 地址，默认 `https://api.openai.com/v1` |
| `QEXO_LLM_API_STYLE` | 可选：`auto`、`chat` 或 `responses`，默认 `auto` |

可选的 `QEXO_SESSION_AGE` 设置登录 Cookie 秒数（默认 7 天），`QEXO_POST_EXTENSIONS` 设置可编辑扩展名（默认 `.md,.markdown`）。非 Vercel 的 HTTPS 反向代理部署应设置 `QEXO_COOKIE_SECURE=1` 和 `QEXO_SSL_REDIRECT=1`；Vercel 会默认启用这两项安全设置。

AI 文章优化为可选功能。设置 `QEXO_LLM_API_KEY` 和 `QEXO_LLM_MODEL` 后在编辑页即可使用优化、校对、精简、扩写与自定义要求。默认使用 OpenAI 兼容的 `chat/completions` 接口，可通过 `QEXO_LLM_BASE_URL` 指向其他兼容服务；如服务只提供 Responses API，可设置 `QEXO_LLM_API_STYLE=responses`。AI 内容由服务端请求，密钥不会发送到浏览器。

正文通过 [Editor.md](https://github.com/pandao/editor.md) 编辑，编辑器脚本和依赖已随仓库本地化，不依赖外部编辑器服务或第三方 CDN。标题、日期、标签、分类及其他 Front Matter 仍在 Blog Admin 的表单中维护，历史文章的多行值、层级分类和自定义字段会完整显示。

文章首页按 20 篇一页懒加载，并显示 Front Matter 中的标题、分类、标签、创建日期及最近编辑日期。Blog Admin 保存文章时会自动更新 `updated` 字段；历史文章若没有 `updated`，会依次兼容 `lastmod`、`modified`、`updated_at`、`last_modified`，最后回退到创建日期。右上角的“关系图谱”以文章、分类和标签为节点展示关联。

全文搜索无需外部数据库或第三方 AI 服务：首次搜索时会在服务端读取文章正文，自动生成兼容中英文的稀疏 TF-IDF 向量，并将标题、分类、标签、摘要和正文的精确匹配与余弦相似度合并排序。该方案是词法向量检索，不会把私有文章发送给嵌入服务；它不等同于大模型语义 Embedding，但在当前无数据库部署模型下可直接运行。索引默认在进程内缓存 300 秒，文章通过 Blog Admin 保存或删除后会立即失效，也可在首页手动刷新；可用 `QEXO_SEARCH_CACHE_SECONDS` 调整为 0–3600 秒。

可直接在 `/setup/` 引导页生成密码哈希；也可在安装依赖的本地环境中交互式生成，密码不会进入命令历史：

```bash
python3 -c 'from django.conf import settings; settings.configure(); from django.contrib.auth.hashers import make_password; from getpass import getpass; print(make_password(getpass("Password: ")))'
```

所有敏感值都应保存在部署平台的 Secret/加密环境变量中，不要写进 Git 仓库或前端代码。`ADMIN_PASSWORD` 明文方式便于配置，但项目管理员和运行中的程序可以读取它；`ADMIN_PASSWORD_HASH` 可提供额外保护，因此更推荐。更新任一种密码配置后，已有登录 Cookie 会自动失效；轮换 `QEXO_SECRET_KEY` 也会使全部登录失效。保存已有文章时会提交当前 GitHub blob SHA；若远端文章已变化，GitHub 会拒绝覆盖并在编辑页保留未保存内容。
## Acknowledgements 鸣谢
- [Ace](https://ace.c9.io/)
- [Argon-Dashboard-Django](https://github.com/creativetimofficial/argon-dashboard-django)
- [Bootstrap](https://getbootstrap.com/)
- [Editor.md](https://github.com/pandao/editor.md)
- [Notyf](https://github.com/caroso1222/notyf)
- [Django](https://github.com/django/django)
- [HexoPlusPlus](https://github.com/HexoPlusPlus/HexoPlusPlus)
- [jQuery](https://jquery.com/)
- [OnePush](https://github.com/y1ndan/onepush)
- [Vercel-Python-WSGI](https://github.com/ardnt/vercel-python-wsgi)
- ...
## Sponsor 赞助
作为一个开源项目，本项目并未给我带来直接利益。若您觉得本项目对您有帮助，您的支持将是我最大的动力。

您可以在备注中附上您的姓名和网站博客。赞助1元及以上者，将在[文档页面](https://www.oplog.cn/qexo/dev/thanks.html)永久展示。

As an open-source project, this project does not provide me with any direct benefits. If you find this project helpful, your support is my greatest motivation.

You can include your name and website blog in the remarks. Sponsorship of 1 RMB or more will be 
permanently displayed on the [documentation page](https://www.oplog.cn/qexo/en/dev/thanks.html).

![Alipay/WeChat](https://github.com/user-attachments/assets/3ad5cf14-9296-4a7e-9a1b-1e4d317532a4)
