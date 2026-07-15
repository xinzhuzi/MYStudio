# Backend Development Guidelines

> Best practices for backend development in this project.

---

## Overview

These guidelines cover the local Python TTS/STT sidecar under `apps/backend/`
and its Electron supervision boundary.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | Complete |
| [Database Guidelines](./database-guidelines.md) | SQLite patterns and additive migrations | Complete |
| [Error Handling](./error-handling.md) | HTTP, async task, and engine failures | Complete |
| [Quality Guidelines](./quality-guidelines.md) | Contract tests and forbidden patterns | Complete |
| [Logging Guidelines](./logging-guidelines.md) | Sidecar logs and secret boundaries | Complete |

---

## How to Fill These Guidelines

For each guideline file:

1. Document your project's **actual conventions** (not ideals)
2. Include **code examples** from your codebase
3. List **forbidden patterns** and why
4. Add **common mistakes** your team has made

The goal is to help AI assistants and new team members understand how YOUR project works.

---

**Language**: All documentation should be written in **English**.
