from typing import Any, Dict

from tradeaid.core.token_queue import token_queue


def analyze_token(token: Dict[str, Any]) -> int:
    score = 0
    market_cap = float(token.get("marketCapUsd") or 0)
    volume = float(token.get("volumeUsd") or 0)

    if market_cap < 100000:
        score += 50
    if volume > 10000:
        score += 50

    return score


def scanner() -> None:
    while True:
        token = token_queue.get()
        print("[AI Scanner] Processing token:", token)

        score = analyze_token(token)
        if score >= 80:
            print("[AI Scanner] HIGH SCORE TOKEN -> TRIGGER SNIPER", token)
            # Hook DoctorTrade sniper trigger here.
