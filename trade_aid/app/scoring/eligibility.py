from datetime import datetime, timedelta
from app.models.models import Token
from app.config import get_settings
from app.utils.logging_config import logger

settings = get_settings()


class EligibilityChecker:
    @staticmethod
    def check_eligibility(token: Token) -> tuple[bool, str]:
        if not token.contract_address:
            return False, "Missing contract address"

        if not token.chain:
            return False, "Missing chain"

        liquidity_age_ok = False
        market_cap_ok = False

        if token.liquidity_created_at:
            age = datetime.utcnow() - token.liquidity_created_at
            if age >= timedelta(minutes=settings.MIN_LIQUIDITY_AGE_MINUTES):
                liquidity_age_ok = True

        if token.market_cap_usd and token.market_cap_usd >= settings.MIN_MARKET_CAP_USD:
            market_cap_ok = True

        if not liquidity_age_ok and not market_cap_ok:
            return False, (
                f"Token must have liquidity age >= {settings.MIN_LIQUIDITY_AGE_MINUTES} min "
                f"OR market cap >= ${settings.MIN_MARKET_CAP_USD:,.0f}"
            )

        if token.liquidity_usd is not None and token.liquidity_usd <= 0:
            return False, "No liquidity available"

        logger.info(
            f"[Eligibility] Token {token.symbol} ({token.chain}): "
            f"eligible (liq_age={liquidity_age_ok}, mcap={market_cap_ok})"
        )
        return True, "Eligible for scoring"


eligibility_checker = EligibilityChecker()
