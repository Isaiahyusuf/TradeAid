from threading import Thread

from tradeaid.core.env_loader import load_env_files
from tradeaid.scanner.ai_scanner import scanner


def start_pipeline() -> None:
    load_env_files()

    from tradeaid.listeners import dexscreener_fallback, pumpfun_feed, raydium_pool

    print("[Pipeline] Starting TradeAid multi-source listener")
    print("[Pipeline] Primary feed: Dexscreener")
    print("[Pipeline] Background listeners: Raydium WS + Raydium/Orca tx logs, Pump.fun backoff polling")

    Thread(target=pumpfun_feed.start_pumpfun_listener, daemon=True).start()
    Thread(target=raydium_pool.start_raydium_listener, daemon=True).start()
    Thread(target=dexscreener_fallback.start_dexscreener_listener, daemon=True).start()

    scanner()


if __name__ == "__main__":
    start_pipeline()
