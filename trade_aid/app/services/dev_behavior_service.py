from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from statistics import median
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import RugHistory, Token
from app.utils.launch_identity import build_launch_fingerprint


class DevBehaviorService:
    @staticmethod
    def _normalize_url(value: str) -> str | None:
        if not value:
            return None
        raw = str(value).strip()
        if not raw:
            return None

        lowered = raw.lower()
        if lowered.startswith("@"):
            return f"https://x.com/{raw[1:]}"
        if lowered.startswith("http://") or lowered.startswith("https://"):
            return raw
        if lowered.startswith("www."):
            return f"https://{raw}"
        if "." in lowered and " " not in lowered:
            return f"https://{raw}"
        return None

    @staticmethod
    def _extract_project_links(extra: dict[str, Any]) -> dict[str, Any]:
        websites_raw = extra.get("websites") or []
        socials_raw = extra.get("socials") or []

        websites: list[str] = []
        if isinstance(websites_raw, list):
            for item in websites_raw:
                if isinstance(item, str):
                    normalized = DevBehaviorService._normalize_url(item)
                    if normalized:
                        websites.append(normalized)

        socials: list[str] = []
        if isinstance(socials_raw, list):
            for item in socials_raw:
                if isinstance(item, str):
                    normalized = DevBehaviorService._normalize_url(item)
                    if normalized:
                        socials.append(normalized)

        x_link = None
        telegram_link = None
        discord_link = None
        for link in socials + websites:
            lowered = link.lower()
            if not x_link and ("x.com/" in lowered or "twitter.com/" in lowered):
                x_link = link
            elif not telegram_link and ("t.me/" in lowered or "telegram.me/" in lowered or "telegram.org/" in lowered):
                telegram_link = link
            elif not discord_link and ("discord.gg/" in lowered or "discord.com/" in lowered):
                discord_link = link

        dedup_websites = []
        seen = set()
        for url in websites + socials:
            lowered = url.lower()
            if any(domain in lowered for domain in ["x.com/", "twitter.com/", "t.me/", "telegram.me/", "discord.gg/", "discord.com/"]):
                continue
            if lowered in seen:
                continue
            seen.add(lowered)
            dedup_websites.append(url)

        return {
            "x": x_link,
            "telegram": telegram_link,
            "discord": discord_link,
            "websites": dedup_websites[:5],
        }

    @staticmethod
    async def _check_url_status(client: httpx.AsyncClient, url: str | None) -> dict[str, Any]:
        if not url:
            return {"available": False, "reachable": False, "status_code": None, "error": None}
        try:
            response = await client.get(url)
            return {
                "available": True,
                "reachable": response.status_code < 400,
                "status_code": response.status_code,
                "error": None,
            }
        except Exception as exc:
            return {
                "available": True,
                "reachable": False,
                "status_code": None,
                "error": str(exc),
            }

    @staticmethod
    def _estimate_community_activity(extra: dict[str, Any], link_count: int) -> tuple[float, str, dict[str, float]]:
        volume_1h = float(extra.get("volume_1h", 0) or 0)
        buys_5m = float(extra.get("buys_5m", 0) or 0)
        sells_5m = float(extra.get("sells_5m", 0) or 0)
        buys_1h = float(extra.get("buys_1h", 0) or 0)
        sells_1h = float(extra.get("sells_1h", 0) or 0)
        price_change_1h = float(extra.get("price_change_1h", 0) or 0)

        trades_5m = buys_5m + sells_5m
        trades_1h = buys_1h + sells_1h

        score = 0.0
        if volume_1h >= 10000:
            score += 35
        elif volume_1h >= 3000:
            score += 20
        elif volume_1h > 0:
            score += 8

        if trades_5m >= 15:
            score += 30
        elif trades_5m >= 5:
            score += 18
        elif trades_5m > 0:
            score += 8

        if trades_1h >= 100:
            score += 20
        elif trades_1h >= 30:
            score += 12
        elif trades_1h > 0:
            score += 5

        if abs(price_change_1h) >= 8:
            score += 15
        elif abs(price_change_1h) >= 3:
            score += 8

        if link_count >= 2:
            score += 10
        elif link_count == 1:
            score += 5

        score = max(0.0, min(100.0, score))
        if score >= 65:
            status = "active"
        elif score >= 40:
            status = "moderate"
        else:
            status = "low"

        return score, status, {
            "volume_1h": volume_1h,
            "trades_5m": trades_5m,
            "trades_1h": trades_1h,
            "price_change_1h": price_change_1h,
        }

    async def get_dev_token_intel(self, db: AsyncSession, contract_address: str, chain: str = "solana") -> dict[str, Any] | None:
        token_result = await db.execute(
            select(Token).where(Token.chain == chain, Token.contract_address == contract_address)
        )
        token = token_result.scalar_one_or_none()
        if not token:
            return None

        extra = token.extra_data or {}
        websites = extra.get("websites") or []
        socials = extra.get("socials") or []

        launch_fingerprint = extra.get("launch_fingerprint") or build_launch_fingerprint(
            deployer_wallet=token.deployer_wallet,
            token_name=token.name,
            token_symbol=token.symbol,
            dex_id=token.dex_id,
            websites=websites if isinstance(websites, list) else [],
            socials=socials if isinstance(socials, list) else [],
            logo_url=extra.get("logo_url"),
        )

        lookback_cutoff = datetime.utcnow() - timedelta(days=30)
        tokens_result = await db.execute(
            select(Token)
            .where(Token.chain == chain, Token.created_at >= lookback_cutoff)
            .order_by(Token.created_at.desc())
            .limit(1200)
        )
        tokens = tokens_result.scalars().all()

        linked_tokens: list[Token] = []
        token_observers = set(extra.get("observer_fingerprints") or [])
        for row in tokens:
            row_extra = row.extra_data or {}
            row_fingerprint = row_extra.get("launch_fingerprint") or build_launch_fingerprint(
                deployer_wallet=row.deployer_wallet,
                token_name=row.name,
                token_symbol=row.symbol,
                dex_id=row.dex_id,
                websites=row_extra.get("websites") if isinstance(row_extra.get("websites"), list) else [],
                socials=row_extra.get("socials") if isinstance(row_extra.get("socials"), list) else [],
                logo_url=row_extra.get("logo_url"),
            )

            same_wallet = bool(token.deployer_wallet and row.deployer_wallet and token.deployer_wallet == row.deployer_wallet)
            same_fingerprint = bool(launch_fingerprint and row_fingerprint and launch_fingerprint == row_fingerprint)
            row_observers = set(row_extra.get("observer_fingerprints") or [])
            same_observer = bool(token_observers and row_observers and token_observers.intersection(row_observers))
            if same_wallet or same_fingerprint or same_observer or row.contract_address == token.contract_address:
                linked_tokens.append(row)

        linked_contracts = [row.contract_address for row in linked_tokens if row.contract_address]
        linked_wallets = sorted({row.deployer_wallet for row in linked_tokens if row.deployer_wallet})

        rugs_result = await db.execute(
            select(RugHistory)
            .where(RugHistory.chain == chain, RugHistory.token_address.in_(linked_contracts if linked_contracts else [contract_address]))
            .order_by(RugHistory.detected_at.desc())
            .limit(200)
        )
        rugs = rugs_result.scalars().all()

        rug_mc_values = [float(r.peak_market_cap_usd or 0) for r in rugs if float(r.peak_market_cap_usd or 0) > 0]
        rug_mc_median = float(median(rug_mc_values)) if rug_mc_values else 0.0
        rug_mc_avg = float(sum(rug_mc_values) / len(rug_mc_values)) if rug_mc_values else 0.0

        def jeet_score_from_token(row: Token) -> float:
            row_extra = row.extra_data or {}
            buys_5m = float(row_extra.get("buys_5m", 0) or 0)
            sells_5m = float(row_extra.get("sells_5m", 0) or 0)
            buys_1h = float(row_extra.get("buys_1h", 0) or 0)
            sells_1h = float(row_extra.get("sells_1h", 0) or 0)
            s5 = min(100.0, (sells_5m / max(buys_5m + 1.0, 1.0)) * 60.0)
            s1 = min(100.0, (sells_1h / max(buys_1h + 1.0, 1.0)) * 40.0)
            return max(0.0, min(100.0, s5 + s1))

        jeet_scores = [jeet_score_from_token(row) for row in linked_tokens[:80]]
        avg_jeet_score = float(sum(jeet_scores) / len(jeet_scores)) if jeet_scores else 0.0
        high_jeet_count = sum(1 for score in jeet_scores if score >= 65)
        high_jeet_ratio = (high_jeet_count / len(jeet_scores)) if jeet_scores else 0.0

        launch_count = len(linked_tokens)
        rug_count = len(rugs)
        rug_ratio = (rug_count / max(launch_count, 1)) * 100
        rug_dev_flag = rug_count >= 2 and rug_ratio >= 25

        links = self._extract_project_links(extra)
        social_link_count = sum(1 for value in [links["x"], links["telegram"], links["discord"]] if value)
        activity_score, overall_status, activity_signals = self._estimate_community_activity(extra, social_link_count)

        async with httpx.AsyncClient(timeout=4.5, follow_redirects=True, headers={"User-Agent": "TradeAid/1.0 community-checker"}) as client:
            x_status, telegram_status, discord_status = await asyncio.gather(
                self._check_url_status(client, links["x"]),
                self._check_url_status(client, links["telegram"]),
                self._check_url_status(client, links["discord"]),
            )

        def make_platform(platform: str, url: str | None, status: dict[str, Any]) -> dict[str, Any]:
            available = bool(url)
            reachable = bool(status.get("reachable")) if available else False
            is_active = available and reachable and activity_score >= 45
            state = "unavailable"
            if available and not reachable:
                state = "unreachable"
            elif is_active:
                state = "active"
            elif available:
                state = "inactive"
            return {
                "platform": platform,
                "url": url,
                "available": available,
                "reachable": reachable,
                "is_active": is_active,
                "status": state,
                "status_code": status.get("status_code"),
            }

        platform_checks = [
            make_platform("x", links["x"], x_status),
            make_platform("telegram", links["telegram"], telegram_status),
            make_platform("discord", links["discord"], discord_status),
        ]
        active_platforms = sum(1 for item in platform_checks if item["is_active"])
        available_platforms = sum(1 for item in platform_checks if item["available"])

        community_summary = (
            f"{active_platforms}/{available_platforms} active social channels detected. "
            f"Community activity signal: {overall_status.upper()} ({activity_score:.0f}/100)."
            if available_platforms > 0
            else "No official X, Telegram, or Discord links found for this project."
        )

        past_launches = [
            {
                "contract_address": row.contract_address,
                "symbol": row.symbol,
                "name": row.name,
                "created_at": str(row.created_at),
                "market_cap_usd": float(row.market_cap_usd or 0),
                "liquidity_usd": float(row.liquidity_usd or 0),
            }
            for row in linked_tokens[:20]
        ]

        return {
            "token": {
                "contract_address": token.contract_address,
                "symbol": token.symbol,
                "name": token.name,
                "deployer_wallet": token.deployer_wallet,
            },
            "identity": {
                "launch_fingerprint": launch_fingerprint,
                "linked_wallet_count": len(linked_wallets),
                "linked_wallets": linked_wallets[:15],
                "link_method": "wallet+launch_fingerprint" if launch_fingerprint else "wallet_only",
                "note": "Fingerprint linking uses launch metadata signatures (domains/socials/branding) and is privacy-safe.",
            },
            "rug_profile": {
                "is_rug_dev": rug_dev_flag,
                "linked_launches": launch_count,
                "linked_rugs": rug_count,
                "rug_ratio_pct": round(rug_ratio, 2),
                "typical_rug_mcap_usd": round(rug_mc_median, 2),
                "average_rug_mcap_usd": round(rug_mc_avg, 2),
            },
            "jeet_checker": {
                "avg_jeet_score": round(avg_jeet_score, 2),
                "high_jeet_ratio_pct": round(high_jeet_ratio * 100, 2),
                "too_many_jeets": high_jeet_ratio >= 0.35,
            },
            "project_info": {
                "social_links": {
                    "x": links["x"],
                    "telegram": links["telegram"],
                    "discord": links["discord"],
                },
                "websites": links["websites"],
                "community_checker": {
                    "activity_score": round(activity_score, 2),
                    "overall_status": overall_status,
                    "active_platforms": active_platforms,
                    "available_platforms": available_platforms,
                    "platforms": platform_checks,
                    "signals": activity_signals,
                    "summary": community_summary,
                },
            },
            "past_launches": past_launches,
            "updated_at": datetime.utcnow().isoformat(),
        }


dev_behavior_service = DevBehaviorService()
