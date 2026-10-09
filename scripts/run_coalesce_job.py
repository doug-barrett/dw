#!/usr/bin/env python3
"""Start a Coalesce job via the API and block until it reaches a terminal state.

    POST {base}/scheduler/startRun            -> {"runCounter": <int>}
    GET  {base}/scheduler/runStatus?runCounter=<int>
                                              -> {"runStatus": ..., "runLink": ...}

Exit codes
    0  completed
    1  failed
    2  canceled
    3  timed out while waiting (the run is still going server-side)
    4  usage / configuration error

Credentials are never accepted as command-line arguments -- see resolve_token().

Stdlib only; no pip install required.
"""

from __future__ import annotations

import argparse
import configparser
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_BASE_URL = "https://app.coalescesoftware.io"
COA_CONFIG = os.path.expanduser("~/.coa/config")

# From the Check Run Status docs. Anything not listed is treated as non-terminal
# so that a newly introduced in-flight state does not look like success.
TERMINAL = {"completed": 0, "failed": 1, "canceled": 2, "cancelled": 2}
IN_FLIGHT = {"running", "waitingtorun", "initializing", "pending"}

SECRET_KEYS = {
    "snowflakekeypairkey",
    "snowflakekeypairpass",
    "snowflakepassword",
    "password",
    "token",
    "databrickstoken",
}


class ConfigError(Exception):
    """Something the operator must fix before we can talk to the API."""


# --------------------------------------------------------------------------
# Credentials
# --------------------------------------------------------------------------

def _read_coa_profile(profile: str) -> dict:
    """Read one [profile] section from ~/.coa/config, refusing loose permissions."""
    if not os.path.exists(COA_CONFIG):
        raise ConfigError(f"{COA_CONFIG} not found")

    mode = os.stat(COA_CONFIG).st_mode & 0o077
    if mode:
        raise ConfigError(
            f"{COA_CONFIG} is group/world accessible (mode {mode:03o}). "
            f"Run: chmod 600 {COA_CONFIG}"
        )

    parser = configparser.ConfigParser()
    parser.read(COA_CONFIG)
    if profile not in parser:
        raise ConfigError(
            f"profile [{profile}] not in {COA_CONFIG}; available: {parser.sections()}"
        )
    return dict(parser[profile])


def resolve_token(profile: str | None) -> str:
    """Resolve the Coalesce access token.

    Order, most explicit first:
      1. COALESCE_ACCESS_TOKEN                 -- CI secret stores, `op run`, etc.
      2. file named by COALESCE_TOKEN_FILE     -- Docker/K8s mounted secret
      3. token= in the named ~/.coa/config profile

    Deliberately NOT supported: a --token flag. Command-line arguments are
    visible to every process on the host via `ps` and land in shell history.
    """
    token = os.environ.get("COALESCE_ACCESS_TOKEN")
    if token:
        return token.strip()

    token_file = os.environ.get("COALESCE_TOKEN_FILE")
    if token_file:
        with open(os.path.expanduser(token_file)) as fh:
            return fh.read().strip()

    if profile:
        token = _read_coa_profile(profile).get("token")
        if token:
            return token.strip()

    raise ConfigError(
        "no access token found. Set COALESCE_ACCESS_TOKEN, or COALESCE_TOKEN_FILE, "
        "or pass --profile naming a section of ~/.coa/config that has token=."
    )


def resolve_user_credentials(profile: str | None) -> dict:
    """Build the userCredentials object the startRun body requires.

    OAuth environments need only {"snowflakeAuthType": "OAuth"}. Key-pair
    environments need the private key MATERIAL, so a key path from the profile
    is expanded to its contents here -- and only here, never logged.
    """
    raw = os.environ.get("COALESCE_USER_CREDENTIALS")
    if raw:
        return json.loads(raw)

    if not profile:
        # Safe default: OAuth carries no secret in the body at all.
        return {"snowflakeAuthType": "OAuth"}

    section = _read_coa_profile(profile)
    creds = {
        key: value
        for key, value in section.items()
        if key.startswith(("snowflake", "databricks", "bigquery")) and value
    }
    if not creds:
        return {"snowflakeAuthType": "OAuth"}

    # coa stores a PATH in snowflakeKeyPairKey; the API wants the key itself.
    key_path = creds.get("snowflakekeypairkey")
    if key_path and os.path.exists(os.path.expanduser(key_path)):
        with open(os.path.expanduser(key_path)) as fh:
            creds["snowflakekeypairkey"] = fh.read()

    passphrase = os.environ.get("COALESCE_KEYPAIR_PASSPHRASE")
    if passphrase:
        creds["snowflakekeypairpass"] = passphrase

    # coa's config keys are lowercase; the API expects camelCase.
    camel = {
        "snowflakeauthtype": "snowflakeAuthType",
        "snowflakekeypairkey": "snowflakeKeyPairKey",
        "snowflakekeypairpass": "snowflakeKeyPairPass",
        "snowflakeusername": "snowflakeUsername",
        "snowflakerole": "snowflakeRole",
        "snowflakewarehouse": "snowflakeWarehouse",
        "snowflakeaccount": "snowflakeAccount",
        "databricksauthtype": "databricksAuthType",
        "databrickstoken": "databricksToken",
        "databrickshost": "databricksHost",
        "databrickspath": "databricksPath",
    }
    return {camel.get(k, k): v for k, v in creds.items()}


def redact(obj):
    """Deep-copy a payload with every secret-ish value replaced, for logging."""
    if isinstance(obj, dict):
        return {
            k: ("<redacted>" if k.lower() in SECRET_KEYS else redact(v))
            for k, v in obj.items()
        }
    if isinstance(obj, list):
        return [redact(v) for v in obj]
    return obj


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------

def request(method: str, url: str, token: str, body: dict | None = None,
            timeout: int = 60, attempts: int = 4) -> dict:
    """One JSON API call, retrying only on transient failures."""
    data = json.dumps(body).encode() if body is not None else None
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
    }
    if data:
        headers["Content-Type"] = "application/json"

    context = ssl.create_default_context()  # verifies certs; never disable this

    for attempt in range(1, attempts + 1):
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=context) as resp:
                return json.loads(resp.read() or "{}")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")[:500]
            if exc.code in (408, 429, 500, 502, 503, 504) and attempt < attempts:
                backoff = min(2 ** attempt, 30)
                log(f"HTTP {exc.code}, retrying in {backoff}s ({attempt}/{attempts})")
                time.sleep(backoff)
                continue
            if exc.code == 401:
                raise ConfigError(
                    "401 Unauthorized -- the access token is invalid or expired."
                ) from exc
            raise ConfigError(f"HTTP {exc.code} from {method} {url}: {detail}") from exc
        except urllib.error.URLError as exc:
            if attempt < attempts:
                backoff = min(2 ** attempt, 30)
                log(f"network error ({exc.reason}), retrying in {backoff}s")
                time.sleep(backoff)
                continue
            raise ConfigError(f"could not reach {url}: {exc.reason}") from exc

    raise ConfigError(f"exhausted retries for {method} {url}")


def log(message: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


# --------------------------------------------------------------------------
# Run lifecycle
# --------------------------------------------------------------------------

def start_run(base_url: str, token: str, run_details: dict,
              user_credentials: dict, parameters: str | None) -> int:
    body = {"runDetails": run_details, "userCredentials": user_credentials}
    if parameters:
        body["parameters"] = parameters

    log(f"POST /scheduler/startRun {json.dumps(redact(body))}")
    result = request("POST", f"{base_url}/scheduler/startRun", token, body)

    run_counter = result.get("runCounter")
    if run_counter is None:
        raise ConfigError(f"startRun returned no runCounter: {result}")
    return int(run_counter)


def wait_for_run(base_url: str, token: str, run_counter: int,
                 poll_interval: int, timeout: int) -> tuple[str, dict]:
    url = (f"{base_url}/scheduler/runStatus?"
           + urllib.parse.urlencode({"runCounter": run_counter}))
    deadline = time.monotonic() + timeout
    last = None

    while True:
        payload = request("GET", url, token)
        status = str(payload.get("runStatus", "")).strip()
        key = status.lower().replace(" ", "")

        if status != last:
            log(f"run {run_counter}: {status or '<empty>'}")
            last = status

        if key in TERMINAL:
            return key, payload

        if key not in IN_FLIGHT:
            # Unknown status: keep waiting rather than guessing it means success.
            log(f"unrecognized runStatus {status!r}; continuing to poll")

        if time.monotonic() >= deadline:
            return "timeout", payload

        time.sleep(poll_interval)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Start a Coalesce job and wait for it to finish.",
        epilog="Credentials come from the environment or ~/.coa/config, never from flags.",
    )
    parser.add_argument("--environment-id", required=True,
                        help="environmentID to refresh")
    parser.add_argument("--job-id", help="jobID to run (omit to use selectors)")
    parser.add_argument("--include", help="includeNodesSelector")
    parser.add_argument("--exclude", help="excludeNodesSelector")
    parser.add_argument("--parallelism", type=int)
    parser.add_argument("--force-ignore-workspace-status", action="store_true")
    parser.add_argument("--parameters",
                        help="runtime parameters as a JSON object string")
    parser.add_argument("--profile",
                        help="section of ~/.coa/config supplying token + warehouse creds")
    parser.add_argument("--base-url",
                        default=os.environ.get("COALESCE_BASE_URL", DEFAULT_BASE_URL))
    parser.add_argument("--poll-interval", type=int, default=15,
                        help="seconds between runStatus polls (default 15)")
    parser.add_argument("--timeout", type=int, default=7200,
                        help="seconds to wait before giving up (default 7200)")
    parser.add_argument("--dry-run", action="store_true",
                        help="print the redacted request and exit without starting a run")
    args = parser.parse_args()

    if not args.job_id and not args.include:
        parser.error("pass --job-id or --include (nothing would run otherwise)")

    base_url = args.base_url.rstrip("/")

    try:
        token = resolve_token(args.profile)
        user_credentials = resolve_user_credentials(args.profile)
    except ConfigError as exc:
        log(f"configuration error: {exc}")
        return 4

    run_details: dict = {"environmentID": str(args.environment_id)}
    if args.job_id:
        run_details["jobID"] = str(args.job_id)
    if args.include:
        run_details["includeNodesSelector"] = args.include
    if args.exclude:
        run_details["excludeNodesSelector"] = args.exclude
    if args.parallelism:
        run_details["parallelism"] = args.parallelism
    if args.force_ignore_workspace_status:
        run_details["forceIgnoreWorkspaceStatus"] = True

    if args.dry_run:
        preview = {"runDetails": run_details, "userCredentials": user_credentials}
        if args.parameters:
            preview["parameters"] = args.parameters
        print(f"POST {base_url}/scheduler/startRun")
        print("Authorization: Bearer <redacted>")
        print(json.dumps(redact(preview), indent=2))
        return 0

    try:
        run_counter = start_run(base_url, token, run_details,
                                user_credentials, args.parameters)
        log(f"started run {run_counter}")

        status, payload = wait_for_run(base_url, token, run_counter,
                                       args.poll_interval, args.timeout)
    except ConfigError as exc:
        log(f"error: {exc}")
        return 4
    except KeyboardInterrupt:
        log("interrupted -- the run continues server-side")
        return 3

    if payload.get("runLink"):
        log(f"run link: {payload['runLink']}")
    if payload.get("hasTestFailures"):
        log("WARNING: the run reported test failures")

    if status == "timeout":
        log(f"gave up after {args.timeout}s; run {run_counter} is still in progress")
        return 3

    log(f"run {run_counter} finished: {status}")
    return TERMINAL[status]


if __name__ == "__main__":
    sys.exit(main())
