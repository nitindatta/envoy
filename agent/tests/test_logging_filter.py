import logging

from app.main import _AgentLogFilter, _is_first_party_logger


def _record(name: str, level: int) -> logging.LogRecord:
    return logging.LogRecord(
        name=name,
        level=level,
        pathname=__file__,
        lineno=1,
        msg="message",
        args=(),
        exc_info=None,
    )


def test_first_party_debug_logs_are_kept() -> None:
    log_filter = _AgentLogFilter()

    assert _is_first_party_logger("cover_letter")
    assert log_filter.filter(_record("cover_letter", logging.DEBUG))


def test_external_info_logs_are_suppressed() -> None:
    log_filter = _AgentLogFilter()

    assert not _is_first_party_logger("aiosqlite")
    assert not log_filter.filter(_record("aiosqlite", logging.INFO))


def test_external_warnings_still_show_up() -> None:
    log_filter = _AgentLogFilter()

    assert log_filter.filter(_record("aiosqlite", logging.WARNING))
