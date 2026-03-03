# intelligence_engine/store.py
"""
Store intelligence result in intelligence_tokens table.
"""
from .models import IntelligenceToken
from .db import SessionLocal
from sqlalchemy.exc import SQLAlchemyError
from datetime import datetime

async def store_intelligence_result(token_data):
    session = SessionLocal()
    try:
        obj = IntelligenceToken(**token_data)
        obj.last_updated = datetime.utcnow()
        session.merge(obj)
        session.commit()
    except SQLAlchemyError:
        session.rollback()
    finally:
        session.close()
