import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import List, Tuple
import httpx
from app.config import get_settings
from app.utils.logging_config import logger

settings = get_settings()


def _smtp_candidates() -> List[Tuple[str, int, bool, bool]]:
    host = (settings.SMTP_HOST or "").strip()
    base_port = int(settings.SMTP_PORT)
    candidates: List[Tuple[str, int, bool, bool]] = [(host, base_port, bool(settings.SMTP_USE_SSL), bool(settings.SMTP_USE_TLS))]

    if host.endswith("gmail.com"):
      gmail_fallbacks: List[Tuple[str, int, bool, bool]] = [
        (host, 465, True, False),
        (host, 587, False, True),
      ]
      for item in gmail_fallbacks:
        if item not in candidates:
          candidates.append(item)

    return candidates


def _send_via_smtp(to_email: str, subject: str, html: str, purpose: str) -> bool:
    if not settings.SMTP_FROM_EMAIL:
      logger.error("[Email] SMTP_FROM_EMAIL must be set")
      return False

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_FROM_EMAIL}>"
    msg["To"] = to_email
    msg.attach(MIMEText(html, "html"))

    context = ssl.create_default_context()
    for host, port, use_ssl, use_tls in _smtp_candidates():
      mode = "SSL" if use_ssl else "STARTTLS" if use_tls else "PLAINTEXT"
      try:
        if use_ssl:
          server = smtplib.SMTP_SSL(host, port, timeout=8, context=context)
        else:
          server = smtplib.SMTP(host, port, timeout=8)

        with server:
          server.ehlo()
          if use_tls and not use_ssl:
            server.starttls(context=context)
            server.ehlo()
          server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
          server.sendmail(settings.SMTP_FROM_EMAIL, [to_email], msg.as_string())

        logger.info(f"[Email] Sent '{purpose}' code to {to_email} via SMTP {host}:{port} ({mode})")
        return True
      except Exception as error:
        logger.error(f"[Email] SMTP failed for {to_email} via {host}:{port} ({mode}): {error}")

    return False


def _send_via_resend(to_email: str, subject: str, html: str) -> bool:
    if not settings.RESEND_API_KEY:
      return False

    from_email = settings.RESEND_FROM_EMAIL or settings.SMTP_FROM_EMAIL
    if not from_email:
      logger.error("[Email] RESEND_FROM_EMAIL or SMTP_FROM_EMAIL must be set")
      return False

    try:
      response = httpx.post(
        f"{settings.RESEND_BASE_URL}/emails",
        headers={
          "Authorization": f"Bearer {settings.RESEND_API_KEY}",
          "Content-Type": "application/json",
        },
        json={
          "from": from_email,
          "to": [to_email],
          "subject": subject,
          "html": html,
        },
        timeout=10.0,
      )
      if 200 <= response.status_code < 300:
        logger.info(f"[Email] Sent via Resend to {to_email}")
        return True

      logger.error(f"[Email] Resend failed ({response.status_code}): {response.text}")
      return False
    except Exception as error:
      logger.error(f"[Email] Resend exception for {to_email}: {error}")
      return False


def send_email_code(to_email: str, subject: str, code: str, purpose: str) -> bool:
    html = f"""
    <div style=\"font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;\">
      <h2 style=\"color:#22c55e; margin-bottom: 8px;\">TradeAid Security Code</h2>
      <p style=\"margin-top: 0; color:#555;\">Use this code to complete your {purpose}:</p>
      <div style=\"font-size: 30px; font-weight: bold; letter-spacing: 6px; padding: 14px 18px; background: #f3f4f6; border-radius: 10px; width: fit-content;\">{code}</div>
      <p style=\"color:#777; margin-top: 16px;\">This code expires in 10 minutes. If you did not request this, ignore this email.</p>
      <p style=\"color:#999; font-size:12px;\">TradeAid</p>
    </div>
    """

    smtp_ready = bool(settings.SMTP_HOST and settings.SMTP_USERNAME and settings.SMTP_PASSWORD and settings.SMTP_FROM_EMAIL)
    resend_ready = bool(settings.RESEND_API_KEY)

    if resend_ready:
      sent_via_resend = _send_via_resend(to_email, subject, html)
      if sent_via_resend:
        return True

    if not smtp_ready:
      if resend_ready:
        logger.warning(f"[Email] Resend configured but delivery failed for {to_email}")
        return False
      logger.warning(f"[Email] No provider configured. Code for {to_email} ({purpose}): {code}")
      return False

    sent_via_smtp = _send_via_smtp(to_email, subject, html, purpose)
    if sent_via_smtp:
      return True

    if resend_ready:
      sent_via_resend = _send_via_resend(to_email, subject, html)
      if sent_via_resend:
        return True

    logger.warning(f"[Email] SMTP and Resend unavailable. Code for {to_email} ({purpose}): {code}")
    return False
