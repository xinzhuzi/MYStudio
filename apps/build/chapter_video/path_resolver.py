#!/usr/bin/env python3
"""Shared path resolution for ChapterVideo build and continuity utilities."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


APP_PROCESS_NAME = "漫影工作室"
UNRESOLVED_PROJECT_DIR_NAME = "__set_MYSTUDIO_PROJECT_DIR_or_ID__"
DEFAULT_WORK_TITLE = "ChapterVideo"


def _requested_project_name() -> str:
    return os.environ.get("CHAPTER_VIDEO_PROJECT_NAME", "").strip()


def env_path(name: str) -> Path | None:
    value = os.environ.get(name, "").strip()
    return Path(value).expanduser() if value else None


def resolve_user_data_dir() -> Path:
    return (
        env_path("MYSTUDIO_USER_DATA_DIR")
        or Path.home() / "Library" / "Application Support" / APP_PROCESS_NAME
    )


def resolve_storage_base_path(user_data_dir: Path | None = None) -> Path:
    if user_data_dir is None:
        user_data_dir = resolve_user_data_dir()
    explicit = env_path("MYSTUDIO_STORAGE_BASE_PATH")
    if explicit:
        return explicit
    config_path = user_data_dir / "storage-config.json"
    try:
        config = json.loads(config_path.read_text("utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return user_data_dir
    if not isinstance(config, dict):
        return user_data_dir
    base_path = str(config.get("basePath") or "").strip()
    if base_path:
        return Path(base_path).expanduser()
    legacy_project_path = str(config.get("projectPath") or "").strip()
    if legacy_project_path:
        return Path(legacy_project_path).expanduser().parent
    return user_data_dir


def _project_store_path(storage_base_path: Path) -> Path:
    return storage_base_path / "projects" / "mystudio-project-store.json"


def _project_records(project_store: Any, project_store_path: Path) -> list[dict[str, Any]]:
    if not isinstance(project_store, dict):
        raise RuntimeError(f"项目目录索引根节点必须是对象: {project_store_path}")
    state = project_store.get("state")
    if not isinstance(state, dict):
        raise RuntimeError(f"项目目录索引缺少 state 对象: {project_store_path}")
    projects = state.get("projects")
    if not isinstance(projects, list):
        raise RuntimeError(f"项目目录索引缺少 state.projects 数组: {project_store_path}")
    records: list[dict[str, Any]] = []
    for index, project in enumerate(projects):
        if not isinstance(project, dict):
            raise RuntimeError(f"项目目录索引 state.projects[{index}] 必须是对象: {project_store_path}")
        records.append(project)
    return records


def resolve_project_id(
    storage_base_path: Path | None = None,
    project_name: str | None = None,
    *,
    required: bool = True,
) -> str | None:
    explicit = os.environ.get("MYSTUDIO_PROJECT_ID", "").strip()
    if explicit:
        return explicit
    if project_name is None:
        project_name = _requested_project_name()
    if storage_base_path is None:
        storage_base_path = resolve_storage_base_path()
    project_store_path = _project_store_path(storage_base_path)
    try:
        project_store = json.loads(project_store_path.read_text("utf-8"))
    except FileNotFoundError:
        if not required:
            return None
        raise RuntimeError(
            "未找到 ChapterVideo 项目索引；请设置 MYSTUDIO_PROJECT_DIR、"
            "MYSTUDIO_PROJECT_ID 或 MYSTUDIO_STORAGE_BASE_PATH"
        ) from None
    except (json.JSONDecodeError, OSError) as error:
        raise RuntimeError(f"无法读取 ChapterVideo 项目索引: {project_store_path}") from error

    records = _project_records(project_store, project_store_path)
    if project_name:
        for project in records:
            project_id = str(project.get("id") or "").strip()
            name = str(project.get("name") or "").strip()
            if project_id and (name == project_name or project_name in name):
                return project_id
    else:
        # No name filter: auto-detect when exactly one project exists.
        ids = [str(p.get("id") or "").strip() for p in records]
        ids = [pid for pid in ids if pid]
        if len(ids) == 1:
            return ids[0]
        if len(ids) > 1 and required:
            raise RuntimeError(
                "项目索引包含多个项目；请设置 CHAPTER_VIDEO_PROJECT_NAME、"
                "MYSTUDIO_PROJECT_DIR 或 MYSTUDIO_PROJECT_ID 指定目标项目"
            )

    if not required:
        return None
    raise RuntimeError(
        f"项目索引中未找到名称包含 {project_name!r} 的项目；"
        "请设置 CHAPTER_VIDEO_PROJECT_DIR 或 MYSTUDIO_PROJECT_ID"
    )


def resolve_work_title(storage_base_path: Path | None = None) -> str:
    """Display title for generated artifacts (export names, workflow names).

    Resolution order: CHAPTER_VIDEO_WORK_TITLE env → resolved project's store
    name → DEFAULT_WORK_TITLE. Keeps generated labels tied to the actual work
    without hardcoding any story name in this repo.
    """
    explicit = os.environ.get("CHAPTER_VIDEO_WORK_TITLE", "").strip()
    if explicit:
        return explicit
    if storage_base_path is None:
        storage_base_path = resolve_storage_base_path()
    project_store_path = _project_store_path(storage_base_path)
    try:
        project_store = json.loads(project_store_path.read_text("utf-8"))
        records = _project_records(project_store, project_store_path)
    except (FileNotFoundError, json.JSONDecodeError, OSError, RuntimeError):
        return DEFAULT_WORK_TITLE
    project_id = resolve_project_id(storage_base_path, required=False)
    for project in records:
        pid = str(project.get("id") or "").strip()
        if project_id is None or pid == project_id:
            name = str(project.get("name") or "").strip()
            if name:
                return name
    return DEFAULT_WORK_TITLE


def resolve_project_dir(
    storage_base_path: Path | None = None,
    project_name: str | None = None,
    *,
    required: bool = True,
) -> Path:
    explicit = env_path("MYSTUDIO_PROJECT_DIR")
    if explicit:
        return explicit
    if storage_base_path is None:
        storage_base_path = resolve_storage_base_path()
    project_id = resolve_project_id(storage_base_path, project_name, required=required)
    if project_id is None:
        return storage_base_path / "projects" / "_p" / UNRESOLVED_PROJECT_DIR_NAME
    default_dir = storage_base_path / "projects" / "_p" / project_id
    # Projects relocated to an external location carry an absolute `location`
    # in the store; prefer it when the directory actually exists there.
    try:
        project_store = json.loads(
            _project_store_path(storage_base_path).read_text("utf-8")
        )
        for project in _project_records(
            project_store, _project_store_path(storage_base_path)
        ):
            if str(project.get("id") or "").strip() != project_id:
                continue
            location = str(project.get("location") or "").strip()
            if location:
                candidate = Path(location).expanduser()
                if candidate.is_dir():
                    return candidate
            break
    except (FileNotFoundError, json.JSONDecodeError, OSError, RuntimeError):
        pass
    return default_dir


def resolve_asset_files_dir(storage_base_path: Path | None = None) -> Path:
    if storage_base_path is None:
        storage_base_path = resolve_storage_base_path()
    return storage_base_path / "assets" / "files"
