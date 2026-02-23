from __future__ import annotations

from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import User
from app.utils.logging_config import logger


class PushNotificationService:
    def __init__(self):
        self.client = httpx.AsyncClient(timeout=12.0)

    @staticmethod
    def _extract_user_tokens(user: User) -> list[str]:
        metadata = user.alert_preferences or {}
        push_meta = metadata.get("push") or {}
        raw_tokens = push_meta.get("expo_tokens") or []
        if isinstance(raw_tokens, str):
            raw_tokens = [raw_tokens]

        tokens: list[str] = []
        for token in raw_tokens:
            token_value = str(token or "").strip()
            if not token_value:
                continue
            if not (
                token_value.startswith("ExponentPushToken[")
                or token_value.startswith("ExpoPushToken[")
            ):
                continue
            tokens.append(token_value)
        return tokens

    async def get_all_registered_tokens(self, db: AsyncSession) -> list[str]:
        result = await db.execute(select(User))
        users = result.scalars().all()
        seen: set[str] = set()
        tokens: list[str] = []
        for user in users:
            for token in self._extract_user_tokens(user):
                if token in seen:
                    continue
                seen.add(token)
                tokens.append(token)
        return tokens

    async def send_alert_push(
        self,
        db: AsyncSession,
        *,
        title: str,
        body: str,
        data: dict[str, Any] | None = None,
    ) -> int:
        tokens = await self.get_all_registered_tokens(db)
        if not tokens:
            return 0

        sent = 0
        for token in tokens:
            payload = {
                "to": token,
                "title": title,
                "body": body,
                "sound": "default",
                "priority": "high",
                "data": data or {},
            }
            try:
                response = await self.client.post(
                    "https://exp.host/--/api/v2/push/send",
                    json=payload,
                )
                if response.status_code < 300:
                    sent += 1
                else:
                    logger.warning(f"[Push] Expo send failed ({response.status_code}): {response.text}")
            except Exception as error:
                logger.warning(f"[Push] Expo send exception: {error}")
        return sent

    async def close(self):
        await self.client.aclose()


push_notification_service = PushNotificationService()