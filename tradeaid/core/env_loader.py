import os
from pathlib import Path


def _load_env_file(path: Path) -> None:
    if not path.exists() or not path.is_file():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if not key:
            continue

        os.environ.setdefault(key, value)


def load_env_files() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    tradeaid_dir = repo_root / "tradeaid"

    # Load project-level env first, then package-local overrides.
    _load_env_file(repo_root / ".env.local")
    _load_env_file(repo_root / ".env")
    _load_env_file(tradeaid_dir / ".env")

    rpc_url = str(os.getenv("HELIUS_RPC_URL") or "").strip()
    helius_key = str(os.getenv("HELIUS_API_KEY") or "").strip()
    if not rpc_url and helius_key:
        os.environ["HELIUS_RPC_URL"] = f"https://mainnet.helius-rpc.com/?api-key={helius_key}"
