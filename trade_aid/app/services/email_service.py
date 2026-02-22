import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import httpx
from app.config import get_settings
from app.utils.logging_config import logger

settings = get_settings()


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
        timeout=20.0,
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

    sent_via_resend = _send_via_resend(to_email, subject, html)
    if sent_via_resend:
      return True

    if not settings.SMTP_HOST or not settings.SMTP_USERNAME or not settings.SMTP_PASSWORD:
      logger.warning(f"[Email] No provider configured. Code for {to_email} ({purpose}): {code}")
      return False

    try:
      msg = MIMEMultipart("alternative")
      msg["Subject"] = subject
      msg["From"] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_FROM_EMAIL}>"
      msg["To"] = to_email
      msg.attach(MIMEText(html, "html"))

      context = ssl.create_default_context()
      if settings.SMTP_USE_SSL:
        server = smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, timeout=20, context=context)
      else:
        server = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=20)

      with server:
        server.ehlo()
        if settings.SMTP_USE_TLS and not settings.SMTP_USE_SSL:
          server.starttls(context=context)
          server.ehlo()
        server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
        server.sendmail(settings.SMTP_FROM_EMAIL, [to_email], msg.as_string())

      logger.info(f"[Email] Sent '{purpose}' code to {to_email}")
      return True
    except Exception as error:
      logger.error(f"[Email] Failed to send code to {to_email}: {error}")
      return False
