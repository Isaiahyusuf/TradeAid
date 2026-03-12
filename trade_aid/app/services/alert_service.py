import asyncio
from datetime import datetime
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import httpx
from app.config import get_settings
from app.models.models import Alert, Token
from app.services.push_notification_service import push_notification_service
from app.utils.redis_client import publish_event
from app.utils.logging_config import logger

settings = get_settings()


class AlertService:
    def __init__(self):
        self.telegram_client = httpx.AsyncClient(timeout=10.0)

    async def create_alert(
        self,
        db: AsyncSession,
        alert_type: str,
        chain: str,
        title: str,
        message: str = "",
        severity: str = "medium",
        contract_address: str = None,
        wallet_address: str = None,
        token_id=None,
        threshold_value: float = None,
        actual_value: float = None,
        metadata: dict = None,
    ) -> Alert:
        alert = Alert(
            token_id=token_id,
            alert_type=alert_type,
            chain=chain,
            severity=severity,
            title=title,
            message=message,
            contract_address=contract_address,
            wallet_address=wallet_address,
            threshold_value=threshold_value,
            actual_value=actual_value,
            metadata=metadata,
        )
        db.add(alert)
        await db.flush()
        await db.refresh(alert)

        await publish_event("alerts", {
            "id": str(alert.id),
            "type": alert_type,
            "chain": chain,
            "severity": severity,
            "title": title,
            "message": message,
            "contract_address": contract_address,
            "created_at": str(alert.created_at),
        })
        alert.is_sent_websocket = True

        if severity in ("high", "critical"):
            sent = await self.send_telegram_alert(alert)
            if sent:
                alert.is_sent_telegram = True

            push_sent_count = await push_notification_service.send_alert_push(
                db,
                title=f"TradeAid {severity.title()} Alert",
                body=title if not message else f"{title}: {message[:120]}",
                data={
                    "alert_id": str(alert.id),
                    "alert_type": alert_type,
                    "chain": chain,
                    "contract_address": contract_address,
                    "severity": severity,
                },
            )
            if push_sent_count:
                logger.info(f"[Push] Sent alert push notifications: {push_sent_count}")

        await db.flush()
        logger.info(f"[Alert] {severity.upper()}: {title}")
        return alert

    async def send_telegram_alert(self, alert: Alert) -> bool:
        if not settings.TELEGRAM_BOT_TOKEN or not settings.TELEGRAM_CHAT_ID:
            return False

        severity_icon = {
            "low": "INFO",
            "medium": "WARN",
            "high": "ALERT",
            "critical": "CRITICAL",
        }

        text = (
            f"[{severity_icon.get(alert.severity, 'ALERT')}] Trade Aid Alert\n\n"
            f"Type: {alert.alert_type}\n"
            f"Chain: {alert.chain}\n"
            f"{alert.title}\n"
        )
        if alert.message:
            text += f"\n{alert.message}\n"
        if alert.contract_address:
            text += f"\nContract: {alert.contract_address}"

        try:
            url = f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/sendMessage"
            response = await self.telegram_client.post(url, json={
                "chat_id": settings.TELEGRAM_CHAT_ID,
                "text": text,
                "parse_mode": "HTML",
            })
            if response.status_code == 200:
                logger.info(f"[Telegram] Alert sent: {alert.title}")
                return True
            else:
                logger.warning(f"[Telegram] Failed to send: {response.text}")
        except Exception as e:
            logger.error(f"[Telegram] Error: {e}")

        return False

    async def send_fresh_launch_alert(self, token: dict, ai_result: dict, status: str) -> bool:
        if not settings.TELEGRAM_BOT_TOKEN or not settings.TELEGRAM_CHAT_ID:
            return False

        token_name = str(token.get("token_name") or token.get("name") or "Unknown")
        symbol = str(token.get("symbol") or "UNK")
        market_cap = float(token.get("market_cap") or 0.0)
        liquidity = float(token.get("liquidity") or 0.0)
        score = float(ai_result.get("score") or 0.0)
        risk = str(ai_result.get("risk") or "UNKNOWN")
        confidence = str(ai_result.get("confidence") or "UNKNOWN")
        mint = str(token.get("mint_address") or token.get("mint") or "")

        text = (
            "🚀 <b>TradeAid Fresh Launch</b>\n\n"
            f"Name: <b>{token_name}</b>\n"
            f"Symbol: <b>{symbol}</b>\n"
            f"MC: <b>${market_cap:,.0f}</b>\n"
            f"Liquidity: <b>${liquidity:,.0f}</b>\n"
            f"AI Score: <b>{score:.2f}</b>\n"
            f"Risk: <b>{risk}</b> | Confidence: <b>{confidence}</b>\n"
            f"Status: <b>{status}</b>\n"
            f"Mint: <code>{mint}</code>"
        )

        try:
            url = f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/sendMessage"
            response = await self.telegram_client.post(
                url,
                json={
                    "chat_id": settings.TELEGRAM_CHAT_ID,
                    "text": text,
                    "parse_mode": "HTML",
                    "disable_web_page_preview": True,
                },
            )
            if response.status_code == 200:
                logger.info(f"[Telegram] Fresh launch sent: {symbol} {mint}")
                return True
            logger.warning(f"[Telegram] Fresh launch send failed: {response.text}")
        except Exception as exc:
            logger.error(f"[Telegram] Fresh launch error: {exc}")

        return False

    async def get_alerts(
        self,
        db: AsyncSession,
        chain: Optional[str] = None,
        alert_type: Optional[str] = None,
        severity: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Alert]:
        query = select(Alert).order_by(Alert.created_at.desc())

        if chain:
            query = query.where(Alert.chain == chain)
        if alert_type:
            query = query.where(Alert.alert_type == alert_type)
        if severity:
            query = query.where(Alert.severity == severity)

        query = query.limit(limit).offset(offset)
        result = await db.execute(query)
        return list(result.scalars().all())

    async def mark_read(self, db: AsyncSession, alert_id: str):
        result = await db.execute(select(Alert).where(Alert.id == alert_id))
        alert = result.scalar_one_or_none()
        if alert:
            alert.is_read = True
            await db.flush()

    async def close(self):
        await self.telegram_client.aclose()


alert_service = AlertService()
