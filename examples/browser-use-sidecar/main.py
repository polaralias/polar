"""
Browser-Use Sidecar - JSON-RPC wrapper around the browser-use library.

Communicates via stdin/stdout JSON-RPC (one JSON object per line).
Uses browser-use's Agent and Browser for all runtime browser automation.
"""

import asyncio
from datetime import datetime, timezone
import glob
import json
import os
import sys
import traceback
from pathlib import Path
from typing import Any, Optional

# Suppress telemetry by default
os.environ.setdefault("ANONYMIZED_TELEMETRY", "false")
# Avoid noisy default browser-use logging setup in sidecar mode.
os.environ.setdefault("BROWSER_USE_SETUP_LOGGING", "false")
# Force UTF-8 behavior on Windows for subprocess stdio.
os.environ.setdefault("PYTHONUTF8", "1")
os.environ.setdefault("PYTHONIOENCODING", "utf-8")


async def lazy_imports():
    """Import browser-use modules lazily to speed up startup."""
    global Agent, Browser, ChatBrowserUse
    from browser_use import Agent, Browser
    from browser_use import ChatBrowserUse


# Globals
_browser: Optional[Any] = None
_browser_config: dict = {}
_imports_ready = False


def _configure_stdio() -> None:
    """Reconfigure stdio streams to UTF-8 where supported."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            try:
                reconfigure(encoding="utf-8", errors="backslashreplace")
            except Exception:
                pass


def _write_json_line(payload: dict) -> None:
    """Write a JSON-RPC line to stdout using UTF-8 bytes (encoding-safe on Windows)."""
    response_str = json.dumps(payload, default=str, ensure_ascii=True)
    sys.stdout.buffer.write((response_str + "\n").encode("utf-8", errors="backslashreplace"))
    sys.stdout.buffer.flush()


def _format_request_error(error: Exception, params: dict) -> str:
    """Add actionable context for common provider/model misconfiguration errors."""
    message = str(error) or error.__class__.__name__

    provider = str((params or {}).get("llm_provider", "")).strip().lower()
    model = str((params or {}).get("llm_model", "")).strip()
    base_url = str((params or {}).get("llm_base_url", "")).strip()

    if "Error code: 404" in message and provider == "openai":
        parts = [f"OpenAI request returned 404 for model '{model or 'unknown'}'."]
        parts.append("The model ID or endpoint is not compatible with the configured OpenAI API format (Responses recommended).")
        if "gpt-5.3-codex" in (model or "").lower():
            parts.append("GPT-5.3-Codex may not yet be enabled for API access on this account/endpoint.")
        if base_url:
            parts.append(f"Browser LLM base URL: {base_url}.")
        parts.append(
            "Set a compatible model/provider/base URL in Browser Automation settings and try again."
        )
        return " ".join(parts)

    return message


def _looks_like_handoff_issue(text: str) -> bool:
    lower = (text or "").lower()
    if not lower:
        return False

    # Configuration/model endpoint issues are not user-handoff cases.
    if "openai request returned 404" in lower:
        return False

    keywords = (
        "login",
        "log in",
        "sign in",
        "authentication",
        "authenticate",
        "mfa",
        "2fa",
        "captcha",
        "verification",
        "security challenge",
        "human verification",
        "access denied",
        "forbidden",
        "unauthorized",
        "session expired",
    )
    return any(k in lower for k in keywords)


def _handoff_message() -> str:
    return (
        "User assistance required. Complete authentication/challenge in the current browser window, "
        "then tell the agent to continue. The same browser session remains active and should resume "
        "from the current page state without restarting completed steps."
    )


def _history_urls(history: Any) -> list[str]:
    try:
        urls = history.urls() if history else []
        return [str(u) for u in urls if u]
    except Exception:
        return []


def _runtime_signal_text(final_result: Any, errors: list[str], extracted_content: list[str]) -> str:
    chunks = [
        str(final_result or ""),
        " ".join(str(e) for e in errors if e),
        " ".join(str(c) for c in extracted_content if c),
    ]
    return " ".join(c for c in chunks if c).strip()


def _contains_404_error(errors: list[str]) -> bool:
    return any("error code: 404" in str(err).lower() for err in errors if err)


def _looks_like_transient_404(
    *,
    errors: list[str],
    final_result: Any,
    extracted_content: list[str],
    urls: list[str],
    needs_user_handoff: bool,
) -> bool:
    if needs_user_handoff or not _contains_404_error(errors):
        return False
    if final_result:
        return False
    return bool(urls or extracted_content)


async def _capture_debug_screenshot(browser: Any) -> Optional[str]:
    try:
        out_dir = Path(__file__).resolve().parent / "debug-screenshots"
        out_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        output_path = out_dir / f"run-task-{timestamp}.png"
        await browser.take_screenshot(path=str(output_path))
        return str(output_path)
    except Exception:
        return None


async def ensure_imports():
    global _imports_ready
    if not _imports_ready:
        await lazy_imports()
        _imports_ready = True


def _normalize_use_vision(value: Any) -> Any:
    """Normalize use_vision values to bool or 'auto'."""
    if value in (True, False, "auto"):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered == "true":
            return True
        if lowered == "false":
            return False
        if lowered == "auto":
            return "auto"
    return "auto"


def _normalize_openai_model(model: str) -> str:
    """Normalize common OpenAI model aliases to documented IDs."""
    raw = (model or "").strip()
    if not raw:
        return "gpt-5-mini"
    lowered = raw.lower().replace("_", "-").replace(" ", "-")
    alias_map = {
        "gpt5.3": "gpt-5.2",
        "gpt-5.3": "gpt-5.2",
        "gpt-5.2-mini": "gpt-5-mini",
        "gpt-5.1-mini": "gpt-5-mini",
        "gpt-5.2-nano": "gpt-5-nano",
        "gpt-5.1-nano": "gpt-5-nano",
        "gpt-5": "gpt-5.2",
        "gpt-4o": "gpt-5-mini",
    }
    return alias_map.get(lowered, raw)


def _is_openai_reasoning_family(model: str) -> bool:
    lower = (model or "").strip().lower()
    return (
        lower.startswith("o1")
        or lower.startswith("o3")
        or lower.startswith("o4")
        or lower.startswith("gpt-5")
        or "gpt-5" in lower
        or lower.startswith("computer-use")
    )


def _merge_browser_config(params: dict) -> dict:
    """Build effective browser configuration from defaults + request params."""
    config = dict(_browser_config)
    if "headless" in params:
        config["headless"] = bool(params.get("headless"))
    if "width" in params:
        config["width"] = int(params.get("width") or 1000)
    if "height" in params:
        config["height"] = int(params.get("height") or 700)
    if "allowed_domains" in params:
        config["allowed_domains"] = params.get("allowed_domains") or []
    if "prohibited_domains" in params:
        config["prohibited_domains"] = params.get("prohibited_domains") or []
    return config


def _browser_executable_globs() -> list[str]:
    """Return glob patterns for Chromium executables across platforms."""
    if sys.platform.startswith("win"):
        return [
            "chromium-*/chrome-win*/chrome.exe",
            "chromium_headless_shell-*/chrome-win*/headless_shell.exe",
            "chromium_headless_shell-*/chrome-win*/chrome.exe",
        ]
    if sys.platform == "darwin":
        return [
            "chromium-*/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
            "chromium_headless_shell-*/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
        ]
    return [
        "chromium-*/chrome-linux*/chrome",
        "chromium_headless_shell-*/chrome-linux*/chrome",
    ]


def _find_browser_executable_in_root(root: Path) -> Optional[str]:
    """Find the newest Chromium executable under a Playwright browser root."""
    if not root.exists():
        return None

    matches: list[Path] = []
    for pattern in _browser_executable_globs():
        full_pattern = str(root / pattern)
        for candidate in glob.glob(full_pattern):
            candidate_path = Path(candidate)
            if candidate_path.is_file():
                matches.append(candidate_path)

    if not matches:
        return None

    matches.sort(
        key=lambda p: p.stat().st_mtime if p.exists() else 0,
        reverse=True,
    )
    return str(matches[0])


def _resolve_browser_executable(params: dict) -> Optional[str]:
    """Resolve an explicit browser executable path, preferring bundled binaries."""
    explicit = str(
        params.get("browser_executable_path")
        or os.environ.get("BROWSER_USE_BROWSER_EXECUTABLE", "")
    ).strip()
    if explicit:
        explicit_path = Path(explicit).expanduser()
        if explicit_path.is_file():
            return str(explicit_path)

    sidecar_dir = Path(__file__).resolve().parent
    candidates = [
        params.get("playwright_browsers_path"),
        os.environ.get("PLAYWRIGHT_BROWSERS_PATH"),
        str(sidecar_dir / "playwright-browsers"),
    ]

    for candidate in candidates:
        if not candidate:
            continue
        root = Path(str(candidate)).expanduser()
        resolved = _find_browser_executable_in_root(root)
        if resolved:
            return resolved

    return None


async def get_browser(params: Optional[dict] = None) -> Any:
    """Get or create the shared Browser instance."""
    global _browser, _browser_config
    await ensure_imports()
    params = params or {}
    requested_config = _merge_browser_config(params)
    executable_path = _resolve_browser_executable(params)
    if executable_path:
        requested_config["executable_path"] = executable_path

    # Recreate browser if critical runtime config changed.
    if _browser is not None and requested_config != _browser_config:
        try:
            await _browser.close()
        except Exception:
            pass
        _browser = None

    if _browser is None:
        headless = requested_config.get("headless", False)
        width = requested_config.get("width", 1000)
        height = requested_config.get("height", 700)
        allowed_domains = requested_config.get("allowed_domains", [])
        prohibited_domains = requested_config.get("prohibited_domains", [])
        executable_path = requested_config.get("executable_path")

        _browser = Browser(
            headless=headless,
            window_size={"width": width, "height": height},
            allowed_domains=allowed_domains or None,
            prohibited_domains=prohibited_domains or None,
            executable_path=executable_path,
            keep_alive=True,
        )
        _browser_config = requested_config
    return _browser


def setup_llm(params: dict) -> Any:
    """Create an LLM instance from parameters."""
    llm_provider = params.get("llm_provider", "browser_use")
    api_key = params.get("llm_api_key", "")

    if llm_provider == "browser_use" or llm_provider == "":
        if api_key:
            os.environ["BROWSER_USE_API_KEY"] = api_key
        return ChatBrowserUse()
    elif llm_provider == "openai":
        from browser_use import ChatOpenAI
        if api_key:
            os.environ["OPENAI_API_KEY"] = api_key
        model = _normalize_openai_model(params.get("llm_model", "gpt-5-mini"))
        llm_base_url = params.get("llm_base_url")
        kwargs = {"model": model}
        # GPT-5/o-series models reject arbitrary temperatures in many modes.
        if _is_openai_reasoning_family(model):
            kwargs["temperature"] = 1.0
        if llm_base_url:
            kwargs["base_url"] = llm_base_url
        return ChatOpenAI(**kwargs)
    elif llm_provider == "anthropic":
        from browser_use import ChatAnthropic
        if api_key:
            os.environ["ANTHROPIC_API_KEY"] = api_key
        model = params.get("llm_model", "claude-sonnet-4-5")
        llm_base_url = params.get("llm_base_url")
        if llm_base_url:
            return ChatAnthropic(model=model, temperature=0.0, base_url=llm_base_url)
        return ChatAnthropic(model=model, temperature=0.0)
    elif llm_provider == "google":
        from browser_use import ChatGoogle
        if api_key:
            os.environ["GOOGLE_API_KEY"] = api_key
        model = params.get("llm_model", "gemini-3-flash-preview-09-2026")
        return ChatGoogle(model=model)
    else:
        # Default to ChatBrowserUse
        if api_key:
            os.environ["BROWSER_USE_API_KEY"] = api_key
        return ChatBrowserUse()


# ---- JSON-RPC Method Handlers ----

async def handle_init(params: dict) -> dict:
    """Initialize browser configuration."""
    global _browser_config, _browser
    _browser_config = {
        "headless": params.get("headless", False),
        "width": params.get("width", 1000),
        "height": params.get("height", 700),
        "allowed_domains": params.get("allowed_domains", []),
        "prohibited_domains": params.get("prohibited_domains", []),
    }
    # Close existing browser if reconfiguring
    if _browser is not None:
        try:
            await _browser.close()
        except Exception:
            pass
        _browser = None
    return {"status": "configured"}


async def handle_run_task(params: dict) -> dict:
    """Run a browser-use Agent task autonomously."""
    await ensure_imports()
    task = params.get("task", "")
    if not task:
        raise ValueError("Missing 'task' parameter")

    max_steps = params.get("max_steps", 100)
    use_vision = _normalize_use_vision(params.get("use_vision", "auto"))
    extend_prompt = params.get("extend_system_message", "")

    browser = await get_browser(params)
    llm = setup_llm(params)

    agent_kwargs = {
        "task": task,
        "browser": browser,
        "llm": llm,
        "use_vision": use_vision,
        # Favor cooperative handoff over repeated autonomous retries.
        "max_failures": int(params.get("max_failures", 2)),
    }
    if extend_prompt:
        agent_kwargs["extend_system_message"] = extend_prompt

    try:
        agent = Agent(**agent_kwargs)
        history = await agent.run(max_steps=max_steps)

        errors = [str(e) for e in (history.errors() if history else []) if e]
        final_result = history.final_result() if history else None
        urls = _history_urls(history)
        extracted_content = history.extracted_content() if history else []
        runtime_text = _runtime_signal_text(final_result, errors, extracted_content)
        needs_user_handoff = _looks_like_handoff_issue(runtime_text)
        transient_404 = _looks_like_transient_404(
            errors=errors,
            final_result=final_result,
            extracted_content=extracted_content,
            urls=urls,
            needs_user_handoff=needs_user_handoff,
        )
        debug_screenshot_path = None
        should_capture_debug = bool(params.get("capture_debug_screenshot_on_error", True))
        if should_capture_debug and (transient_404 or (errors and not final_result)):
            debug_screenshot_path = await _capture_debug_screenshot(browser)

        # Extract results from history
        result = {
            "final_result": final_result,
            "is_done": history.is_done() if history else False,
            "is_successful": history.is_successful() if history else None,
            "urls": urls,
            "errors": errors,
            "extracted_content": extracted_content,
            "action_names": history.action_names() if history else [],
            "num_steps": history.number_of_steps() if history else 0,
            "needs_user_handoff": needs_user_handoff,
            "session_state": "waiting_for_user" if needs_user_handoff else "completed",
            "handoff_message": _handoff_message() if needs_user_handoff else None,
        }
        if transient_404:
            result["error_classification"] = "transient_404"
            result["recovery_suggestion"] = (
                "Transient 404 detected while the page appears reachable. Continue in the same "
                "session, then go back once and reload the target URL before resuming extraction."
            )
        if debug_screenshot_path:
            result["debug_screenshot_path"] = debug_screenshot_path

        return result
    except Exception as e:
        message = _format_request_error(e, params)
        if _looks_like_handoff_issue(message):
            return {
                "final_result": None,
                "is_done": False,
                "is_successful": False,
                "urls": [],
                "errors": [message],
                "extracted_content": [],
                "action_names": [],
                "num_steps": 0,
                "needs_user_handoff": True,
                "session_state": "waiting_for_user",
                "handoff_message": _handoff_message(),
            }
        raise


async def handle_navigate(params: dict) -> dict:
    """Navigate the browser to a URL directly."""
    await ensure_imports()
    url = params.get("url", "")
    if not url:
        raise ValueError("Missing 'url' parameter")

    browser = await get_browser(params)

    # Use a minimal agent task for navigation
    llm = setup_llm(params)
    agent = Agent(
        task=f"Navigate to {url} and report the page title",
        browser=browser,
        llm=llm,
        flash_mode=True,
    )
    history = await agent.run(max_steps=5)

    return {
        "url": url,
        "final_result": history.final_result() if history else None,
        "urls": history.urls() if history else [],
    }


async def handle_extract(params: dict) -> dict:
    """Extract content from the current page using the LLM."""
    await ensure_imports()
    query = params.get("query", "Extract all visible text content from this page")

    browser = await get_browser(params)
    llm = setup_llm(params)

    agent = Agent(
        task=f"On the current page, extract the following: {query}. Use the extract action.",
        browser=browser,
        llm=llm,
        flash_mode=True,
    )
    history = await agent.run(max_steps=10)

    return {
        "content": history.final_result() if history else None,
        "extracted": history.extracted_content() if history else [],
    }


async def handle_screenshot(params: dict) -> dict:
    """Take a screenshot of the current browser page."""
    await ensure_imports()

    browser = await get_browser(params)
    llm = setup_llm(params)

    agent = Agent(
        task="Take a screenshot of the current page using the screenshot action, then report done.",
        browser=browser,
        llm=llm,
        flash_mode=True,
    )
    history = await agent.run(max_steps=3)

    screenshots = history.screenshots() if history else []
    paths = history.screenshot_paths() if history else []

    return {
        "screenshots_base64": screenshots[:1] if screenshots else [],
        "screenshot_paths": [str(p) for p in paths[:1]] if paths else [],
    }


async def handle_close(params: dict) -> dict:
    """Close the browser."""
    global _browser
    if _browser is not None:
        try:
            await _browser.close()
        except Exception:
            pass
        _browser = None
    return {"status": "closed"}


async def handle_status(params: dict) -> dict:
    """Get browser status."""
    global _browser
    is_running = _browser is not None
    return {
        "running": is_running,
        "config": _browser_config,
    }


async def handle_shutdown(params: dict) -> dict:
    """Shutdown the sidecar."""
    await handle_close(params)
    return {"status": "shutdown"}


# Method dispatch table
METHODS = {
    "init": handle_init,
    "run_task": handle_run_task,
    "navigate": handle_navigate,
    "extract": handle_extract,
    "screenshot": handle_screenshot,
    "close": handle_close,
    "status": handle_status,
    "shutdown": handle_shutdown,
}


async def handle_request(request: dict) -> dict:
    """Process a single JSON-RPC request."""
    req_id = request.get("id", 0)
    method = request.get("method", "")
    params = request.get("params", {})

    handler = METHODS.get(method)
    if handler is None:
        return {
            "id": req_id,
            "ok": False,
            "result": None,
            "error": f"Unknown method: {method}",
        }

    try:
        result = await handler(params)
        return {
            "id": req_id,
            "ok": True,
            "result": result,
            "error": None,
        }
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        return {
            "id": req_id,
            "ok": False,
            "result": None,
            "error": _format_request_error(e, params),
        }


async def main():
    """Main event loop - reads JSON-RPC from stdin, writes responses to stdout."""
    _configure_stdio()
    print("[browser-use-sidecar] Starting...", file=sys.stderr, flush=True)

    while True:
        try:
            # Use thread-based stdin reads for Windows compatibility.
            line = await asyncio.to_thread(sys.stdin.buffer.readline)
            if not line:
                break

            line_str = line.decode("utf-8", errors="replace").strip()
            if not line_str:
                continue

            request = json.loads(line_str)
            response = await handle_request(request)

            _write_json_line(response)

        except json.JSONDecodeError as e:
            error_response = {
                "id": 0,
                "ok": False,
                "result": None,
                "error": f"Invalid JSON: {e}",
            }
            _write_json_line(error_response)
        except Exception as e:
            print(f"[browser-use-sidecar] Error: {e}", file=sys.stderr, flush=True)
            traceback.print_exc(file=sys.stderr)
            error_response = {
                "id": 0,
                "ok": False,
                "result": None,
                "error": str(e),
            }
            _write_json_line(error_response)

    # Clean up
    await handle_close({})
    print("[browser-use-sidecar] Shutdown.", file=sys.stderr, flush=True)


if __name__ == "__main__":
    asyncio.run(main())
