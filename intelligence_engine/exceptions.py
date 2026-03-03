"""intelligence_engine.exceptions

Custom exceptions for classification of errors.
"""
from typing import Optional

class IntelligenceError(Exception):
    """Base class for intelligence engine errors."""
    pass


class NetworkError(IntelligenceError):
    def __init__(self, message: str, url: Optional[str] = None):
        super().__init__(message)
        self.url = url


class DataValidationError(IntelligenceError):
    def __init__(self, message: str, source: Optional[str] = None):
        super().__init__(message)
        self.source = source


class ParsingError(IntelligenceError):
    def __init__(self, message: str, payload: Optional[dict] = None):
        super().__init__(message)
        self.payload = payload
