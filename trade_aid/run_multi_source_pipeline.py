from __future__ import annotations

import logging
import threading

from core.scanner_pipeline import scanner_loop
from listeners.dex_pairs_listener import run_dex_pairs_listener
from listeners.pumpfun_listener import run_pumpfun_listener
from listeners.raydium_listener import run_raydium_listener


def _spawn(name: str, target) -> threading.Thread:
    thread = threading.Thread(target=target, name=name, daemon=True)
    thread.start()
    return thread


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    threads = [
        _spawn("pumpfun-listener", run_pumpfun_listener),
        _spawn("dex-pairs-listener", run_dex_pairs_listener),
        _spawn("raydium-listener", run_raydium_listener),
        _spawn("token-scanner", scanner_loop),
    ]

    for thread in threads:
        thread.join()


if __name__ == "__main__":
    main()
