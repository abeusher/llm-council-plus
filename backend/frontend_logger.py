"""Frontend browser event logging module.

Receives log events from the frontend and writes them to logs/frontend.log.
"""

import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Optional, List
from pydantic import BaseModel, Field

# Configure dedicated frontend logger
LOGS_DIR = Path(__file__).parent.parent / "logs"
LOGS_DIR.mkdir(exist_ok=True)

frontend_log_file = LOGS_DIR / "frontend.log"

# Create a dedicated logger for frontend events
frontend_logger = logging.getLogger("frontend")
frontend_logger.setLevel(logging.DEBUG)
frontend_logger.propagate = False  # Don't propagate to root logger

# File handler for frontend logs
file_handler = logging.FileHandler(frontend_log_file, encoding="utf-8")
file_handler.setLevel(logging.DEBUG)

# Format: timestamp | level | message | metadata
formatter = logging.Formatter(
    "%(asctime)s | %(levelname)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
file_handler.setFormatter(formatter)
frontend_logger.addHandler(file_handler)


class FrontendLogEntry(BaseModel):
    """Model for frontend log entries."""
    level: str = Field(..., pattern="^(debug|info|warning|error|fatal)$")
    message: str = Field(..., max_length=10000)
    timestamp: Optional[str] = None
    url: Optional[str] = Field(default=None, max_length=2000)
    user_agent: Optional[str] = Field(default=None, max_length=500)
    stack_trace: Optional[str] = Field(default=None, max_length=50000)
    component: Optional[str] = Field(default=None, max_length=100)
    metadata: Optional[dict] = None


class FrontendLogBatch(BaseModel):
    """Model for batch log submissions."""
    entries: List[FrontendLogEntry] = Field(..., max_length=100)


def log_frontend_event(entry: FrontendLogEntry, client_ip: Optional[str] = None) -> bool:
    """
    Log a frontend event to the frontend.log file.

    Args:
        entry: The log entry from the frontend
        client_ip: Optional client IP address

    Returns:
        True if logged successfully, False otherwise
    """
    try:
        # Map frontend level to Python logging level
        level_map = {
            "debug": logging.DEBUG,
            "info": logging.INFO,
            "warning": logging.WARNING,
            "error": logging.ERROR,
            "fatal": logging.CRITICAL,
        }
        log_level = level_map.get(entry.level.lower(), logging.INFO)

        # Build log message with metadata
        parts = [entry.message]

        if entry.component:
            parts.insert(0, f"[{entry.component}]")

        if entry.url:
            parts.append(f"| url={entry.url}")

        if client_ip:
            parts.append(f"| ip={client_ip}")

        if entry.stack_trace:
            parts.append(f"\nStack trace:\n{entry.stack_trace}")

        if entry.metadata:
            # Filter out sensitive data
            safe_metadata = {k: v for k, v in entry.metadata.items()
                          if k not in ("password", "token", "secret", "key")}
            if safe_metadata:
                parts.append(f"| metadata={safe_metadata}")

        log_message = " ".join(str(p) for p in parts if p)

        frontend_logger.log(log_level, log_message)
        return True

    except Exception as e:
        # Log to main logger if frontend logging fails
        logging.getLogger(__name__).error(f"Failed to log frontend event: {e}")
        return False
