"""Data delivery at container start: fetch the two Parquet files from a Hugging Face dataset repo.

Run: `uv run python -m hotspots.bootstrap` (config from `HOTSPOTS_CONFIG`, default
`config/app.yaml`). DEFAULT (confirm), design decision 6: the data files are never in git or in
the image. They live in a private or public dataset repo and are downloaded into the configured
data folder when they are missing.

- Nothing happens when both files already exist (for example a mounted `outputs2.0/`).
- `HF_DATASET_REPO` (for example `org/name`) and `HF_TOKEN` (a Space secret) are read from the
  environment only. The token is never printed, logged, or put in an error message.
- Each missing file is downloaded to a staging folder inside the data folder, moved into place,
  then both files are checked with the data-contract check (`hotspots.data.check`). When the
  check fails, the files fetched in this run are removed, so a bad download is not trusted on
  the next start.
- Exit codes: 0 data present or delivered, 1 delivery failed (message on stderr), 2 the
  configuration is invalid. The API starts without data in the "unavailable" state
  (Requirement 32.7), so `scripts/entrypoint.sh` starts uvicorn even when this exits non-zero.

Units and conventions of the data are in `data-contract.md`; this module moves files only.
"""

from __future__ import annotations

import logging
import os
import shutil
import sys
import tempfile
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

from huggingface_hub import hf_hub_download
from huggingface_hub.errors import (
    EntryNotFoundError,
    GatedRepoError,
    HfHubHTTPError,
    RemoteEntryNotFoundError,
    RepositoryNotFoundError,
)

from hotspots.config import DETECTIONS_FILENAME, GRID_FILENAME, AppConfig, ConfigErrors, load_config
from hotspots.data.check import CheckResult, check_delivered
from hotspots.data.types import DataUnavailableError

logger = logging.getLogger("hotspots.bootstrap")

REPO_ENV_VAR: Final[str] = "HF_DATASET_REPO"
TOKEN_ENV_VAR: Final[str] = "HF_TOKEN"
REPO_TYPE: Final[str] = "dataset"
_STAGING_PREFIX: Final[str] = ".download-"
_REDACTED: Final[str] = "***"

Downloader = Callable[..., str]
"""Same call shape as `huggingface_hub.hf_hub_download` (keyword arguments)."""
Verifier = Callable[[AppConfig], Sequence[CheckResult]]
"""Same call shape as `hotspots.data.check.check_delivered`."""


class BootstrapError(Exception):
    """Data delivery failed. The message is safe to print (it never holds the token)."""


@dataclass(frozen=True)
class BootstrapResult:
    """What `bootstrap` did. `downloaded` lists the file names fetched in this run."""

    downloaded: tuple[str, ...]


def scrub(text: str, secret: str | None) -> str:
    """Replace every occurrence of `secret` in `text`, so it cannot reach logs or messages."""
    if secret:
        return text.replace(secret, _REDACTED)
    return text


def missing_files(cfg: AppConfig) -> list[str]:
    """Names of the two delivered files that are not in the config data folder."""
    return [
        name
        for name, path in (
            (GRID_FILENAME, cfg.grid_path),
            (DETECTIONS_FILENAME, cfg.detections_path),
        )
        if not path.is_file()
    ]


def bootstrap(
    cfg: AppConfig,
    env: Mapping[str, str] | None = None,
    *,
    download: Downloader = hf_hub_download,
    verify: Verifier = check_delivered,
) -> BootstrapResult:
    """Make sure both Parquet files are in `cfg.data_dir`, downloading missing ones.

    Raises `BootstrapError` (message safe to print) when the repo or token is not set, the
    download fails, or the downloaded files fail the data-contract check.
    """
    environ = os.environ if env is None else env
    missing = missing_files(cfg)
    if not missing:
        logger.info("Data files present in %s; nothing to download.", cfg.data_dir)
        return BootstrapResult(downloaded=())

    repo = environ.get(REPO_ENV_VAR, "").strip()
    token = environ.get(TOKEN_ENV_VAR, "").strip()
    _require_settings(repo, token, missing, cfg.data_dir)

    logger.info("Missing in %s: %s. Downloading from dataset repo %s.", cfg.data_dir, missing, repo)
    placed: list[Path] = []
    try:
        for name in missing:
            placed.append(_fetch_one(repo, token, name, cfg.data_dir, download))
        _verify(cfg, verify)
    except BaseException:  # includes BootstrapError; never leave unverified files behind
        _remove(placed)
        raise
    logger.info("Downloaded and verified: %s", ", ".join(missing))
    return BootstrapResult(downloaded=tuple(missing))


def _require_settings(repo: str, token: str, missing: Sequence[str], data_dir: Path) -> None:
    unset = [var for var, value in ((REPO_ENV_VAR, repo), (TOKEN_ENV_VAR, token)) if not value]
    if unset:
        raise BootstrapError(
            f"Data files missing from {data_dir} ({', '.join(missing)}) and "
            f"{' and '.join(unset)} not set in the environment. Set {REPO_ENV_VAR} to the "
            f"Hugging Face dataset repo and {TOKEN_ENV_VAR} to a read token (Space secret), "
            "or mount the data folder."
        )


def _fetch_one(repo: str, token: str, name: str, data_dir: Path, download: Downloader) -> Path:
    """Download one file to a staging folder next to its destination and move it into place."""
    staging: Path | None = None
    try:
        data_dir.mkdir(parents=True, exist_ok=True)
        staging = Path(tempfile.mkdtemp(prefix=_STAGING_PREFIX, dir=data_dir))
        fetched = Path(
            download(
                repo_id=repo,
                filename=name,
                repo_type=REPO_TYPE,
                token=token,
                local_dir=staging,
            )
        )
        destination = data_dir / name
        os.replace(fetched, destination)
        return destination
    except BootstrapError:
        raise
    except Exception as exc:
        raise BootstrapError(_describe_download_error(exc, repo, name, token)) from None
    finally:
        if staging is not None:
            shutil.rmtree(staging, ignore_errors=True)


def _describe_download_error(exc: Exception, repo: str, name: str, token: str) -> str:
    """Turn a download exception into a clear message without the token."""
    if isinstance(exc, RepositoryNotFoundError | GatedRepoError):
        reason = f"dataset repo {repo!r} was not found, or {TOKEN_ENV_VAR} has no read access to it"
    elif isinstance(exc, EntryNotFoundError | RemoteEntryNotFoundError):
        reason = f"file {name!r} is not in dataset repo {repo!r}"
    elif isinstance(exc, HfHubHTTPError):
        status = getattr(getattr(exc, "response", None), "status_code", None)
        if status in (401, 403):
            reason = f"{TOKEN_ENV_VAR} was rejected (HTTP {status}); check the token and its scope"
        else:
            reason = f"Hugging Face request failed ({scrub(str(exc), token)})"
    else:
        reason = f"{type(exc).__name__}: {scrub(str(exc), token)}"
    return scrub(f"Could not download {name} from dataset repo {repo!r}: {reason}", token)


def _verify(cfg: AppConfig, verify: Verifier) -> None:
    """Run the data-contract check on the files now in the data folder."""
    try:
        results = verify(cfg)
    except DataUnavailableError as exc:
        raise BootstrapError(f"Downloaded files cannot be read: {exc}") from None
    failed: list[Any] = [r for r in results if not r.passed]
    if failed:
        lines = "; ".join(f"{r.name}: {r.detail}" for r in failed)
        raise BootstrapError(
            f"Downloaded files do not match the data contract ({len(failed)} check(s) failed): "
            f"{lines}"
        )


def _remove(paths: Sequence[Path]) -> None:
    for path in paths:
        try:
            path.unlink(missing_ok=True)
        except OSError:  # best effort: the failure being reported matters more
            logger.warning("Could not remove %s", path)


def main(argv: Sequence[str] | None = None) -> int:
    """Run the delivery and return the process exit code."""
    _ = argv  # no options; settings come from the config file and the environment
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    cfg = load_config(require_data=False)
    if isinstance(cfg, ConfigErrors):
        print(cfg.format(), file=sys.stderr)
        return 2
    try:
        result = bootstrap(cfg)
    except BootstrapError as exc:
        print(f"Data delivery failed: {exc}", file=sys.stderr)
        return 1
    if result.downloaded:
        print(f"Data delivered: {', '.join(result.downloaded)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
