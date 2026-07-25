"""Outbound SMTP helpers for TrueGage notification emails."""

from __future__ import annotations

import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Optional

from app.models import AppSettings
from app.security import decrypt_secret


class EmailError(Exception):
    pass


@dataclass
class SmtpConfig:
    host: str
    port: int
    username: Optional[str]
    password: Optional[str]
    use_tls: bool
    from_email: str
    from_name: str


def smtp_configured(row: AppSettings) -> bool:
    return bool(row.smtp_host and row.smtp_from_email and row.smtp_password_encrypted)


def load_smtp_config(row: AppSettings) -> SmtpConfig:
    if not row.smtp_host or not row.smtp_from_email:
        raise EmailError("SMTP host and From email are required")
    if not row.smtp_password_encrypted:
        raise EmailError("SMTP password is not configured")
    try:
        password = decrypt_secret(row.smtp_password_encrypted)
    except Exception as exc:
        raise EmailError("Could not decrypt SMTP password") from exc
    return SmtpConfig(
        host=row.smtp_host.strip(),
        port=int(row.smtp_port or 587),
        username=(row.smtp_username or "").strip() or None,
        password=password,
        use_tls=bool(row.smtp_use_tls),
        from_email=row.smtp_from_email.strip(),
        from_name=(row.smtp_from_name or "TrueGage").strip() or "TrueGage",
    )


def build_message(
    *,
    config: SmtpConfig,
    to_email: str,
    to_name: str,
    subject: str,
    text_body: str,
    html_body: Optional[str] = None,
) -> EmailMessage:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"{config.from_name} <{config.from_email}>"
    display_to = f"{to_name} <{to_email}>" if to_name else to_email
    msg["To"] = display_to
    msg.set_content(text_body)
    if html_body:
        msg.add_alternative(html_body, subtype="html")
    return msg


def send_message(config: SmtpConfig, message: EmailMessage) -> None:
    try:
        if config.use_tls and config.port == 465:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(config.host, config.port, timeout=30, context=context) as smtp:
                if config.username:
                    smtp.login(config.username, config.password or "")
                smtp.send_message(message)
            return

        with smtplib.SMTP(config.host, config.port, timeout=30) as smtp:
            smtp.ehlo()
            if config.use_tls:
                context = ssl.create_default_context()
                smtp.starttls(context=context)
                smtp.ehlo()
            if config.username:
                smtp.login(config.username, config.password or "")
            smtp.send_message(message)
    except smtplib.SMTPAuthenticationError as exc:
        raise EmailError(f"SMTP authentication failed: {exc}") from exc
    except smtplib.SMTPException as exc:
        raise EmailError(f"SMTP error: {exc}") from exc
    except OSError as exc:
        raise EmailError(f"Could not reach SMTP server: {exc}") from exc


def _escape(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


# Match web app stacks from styles.css / __root.tsx
FONT_SANS = "'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
FONT_DISPLAY = "'Space Grotesk', 'Inter', ui-sans-serif, system-ui, sans-serif"
FONT_MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"

FONT_LINKS = """\
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;family=Space+Grotesk:wght@500;600;700&amp;family=JetBrains+Mono:wght@400;500&amp;display=swap" rel="stylesheet" />
  <style type="text/css">
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
  </style>
"""


@dataclass
class OverdueEquipmentRow:
    name: str
    tag: str
    due_date: str
    days_overdue: int


def send_test_email(config: SmtpConfig, *, to_email: str, to_name: str = "") -> None:
    name = to_name.strip() or "there"
    safe_name = _escape(name)
    safe_from = _escape(config.from_email)
    subject = "TrueGage delivery check — you’re connected"

    # Match web app stacks from styles.css / __root.tsx
    font_sans = FONT_SANS
    font_display = FONT_DISPLAY
    font_mono = FONT_MONO

    text = (
        f"Hi {name},\n\n"
        "Your TrueGage email delivery check succeeded.\n\n"
        "This temporary message confirms that SMTP is configured correctly and "
        "calibration alerts can reach your team inbox.\n\n"
        f"Sent via: {config.from_email}\n"
        "You can close this message — no action is required.\n\n"
        "— TrueGage Metrology\n"
    )

    html = f"""\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>TrueGage delivery check</title>
{FONT_LINKS}
  <!--[if mso]>
  <style type="text/css">
    body, table, td {{ font-family: Arial, Helvetica, sans-serif !important; }}
  </style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background:#0b1220;font-family:{font_sans};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0b1220;padding:32px 16px;font-family:{font_sans};">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#111827;border:1px solid #1f2a3c;border-radius:14px;overflow:hidden;font-family:{font_sans};">
          <tr>
            <td style="background:linear-gradient(135deg,#0f766e 0%,#115e59 55%,#0b3f3a 100%);padding:28px 28px 22px;">
              <div style="font-family:{font_sans};font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.72);">
                TrueGage · Metrology Control
              </div>
              <div style="font-family:{font_display};font-size:26px;line-height:1.25;color:#ffffff;margin-top:10px;font-weight:600;letter-spacing:-0.02em;">
                Delivery check passed
              </div>
              <div style="font-family:{font_sans};font-size:14px;line-height:1.5;font-weight:400;color:rgba(255,255,255,0.86);margin-top:8px;">
                Outbound SMTP is live for this workspace.
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;font-family:{font_sans};">
              <p style="margin:0 0 14px;font-family:{font_sans};font-size:15px;line-height:1.6;font-weight:500;color:#e5e7eb;">
                Hi {safe_name},
              </p>
              <p style="margin:0 0 14px;font-family:{font_sans};font-size:15px;line-height:1.6;font-weight:400;color:#cbd5e1;">
                This is a temporary check from <strong style="font-weight:600;color:#f8fafc;">TrueGage</strong>.
                Receiving it means calibration reminder emails can reach your team from this system.
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;background:#0b1220;border:1px solid #243044;border-radius:10px;">
                <tr>
                  <td style="padding:16px 18px;">
                    <div style="font-family:{font_sans};font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;margin-bottom:6px;">
                      Status
                    </div>
                    <div style="font-family:{font_display};font-size:16px;font-weight:600;letter-spacing:-0.01em;color:#2dd4bf;">
                      ● Connected
                    </div>
                    <div style="font-family:{font_mono};font-size:12px;font-weight:400;color:#94a3b8;margin-top:10px;">
                      From: {safe_from}
                    </div>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-family:{font_sans};font-size:13px;line-height:1.55;font-weight:400;color:#94a3b8;">
                No action needed — you can archive this message. Alarm rules and team recipients
                are managed in TrueGage Settings.
              </p>
            </td>
          </tr>
          <tr>
            <td style="border-top:1px solid #1f2a3c;padding:16px 28px 22px;background:#0d1422;">
              <div style="font-family:{font_sans};font-size:12px;font-weight:500;color:#64748b;">
                TrueGage · Manufacturing calibration monitoring
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
"""
    msg = build_message(
        config=config,
        to_email=to_email,
        to_name=to_name,
        subject=subject,
        text_body=text,
        html_body=html,
    )
    send_message(config, msg)


def send_overdue_alert_email(
    config: SmtpConfig,
    *,
    to_email: str,
    to_name: str,
    items: list[OverdueEquipmentRow],
    cta_url: str,
) -> None:
    if not items:
        raise EmailError("No overdue equipment to include in the email")

    name = to_name.strip() or "there"
    safe_name = _escape(name)
    safe_cta = _escape(cta_url)
    count = len(items)
    subject = f"TrueGage — {count} calibration{'s' if count != 1 else ''} overdue"

    lines = [
        f"Hi {name},",
        "",
        f"{count} equipment item{'s are' if count != 1 else ' is'} past the calibration due date:",
        "",
    ]
    for row in items:
        lines.append(f"• {row.name} ({row.tag}) — due {row.due_date} ({row.days_overdue}d overdue)")
    lines.extend(
        [
            "",
            "Please schedule verification as soon as possible.",
            "",
            f"View overdue equipment: {cta_url}",
            "",
            "— TrueGage Metrology",
        ]
    )
    text = "\n".join(lines)

    rows_html = ""
    for row in items:
        rows_html += f"""\
<tr>
  <td style="padding:12px 14px;border-bottom:1px solid #243044;font-family:{FONT_SANS};">
    <div style="font-family:{FONT_SANS};font-size:14px;font-weight:600;color:#f8fafc;">{_escape(row.name)}</div>
    <div style="font-family:{FONT_MONO};font-size:11px;color:#94a3b8;margin-top:4px;">{_escape(row.tag)}</div>
  </td>
  <td style="padding:12px 14px;border-bottom:1px solid #243044;font-family:{FONT_MONO};font-size:13px;color:#cbd5e1;white-space:nowrap;">
    {_escape(row.due_date)}
  </td>
  <td style="padding:12px 14px;border-bottom:1px solid #243044;text-align:right;">
    <span style="display:inline-block;font-family:{FONT_SANS};font-size:11px;font-weight:700;color:#fecaca;background:rgba(239,68,68,0.18);border-radius:6px;padding:4px 8px;">
      {row.days_overdue}d overdue
    </span>
  </td>
</tr>
"""

    html = f"""\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Overdue calibrations</title>
{FONT_LINKS}
</head>
<body style="margin:0;padding:0;background:#0b1220;font-family:{FONT_SANS};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0b1220;padding:32px 16px;font-family:{FONT_SANS};">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#111827;border:1px solid #1f2a3c;border-radius:14px;overflow:hidden;">
          <tr>
            <td style="background:linear-gradient(135deg,#b91c1c 0%,#7f1d1d 55%,#450a0a 100%);padding:28px;">
              <div style="font-family:{FONT_SANS};font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.72);">
                TrueGage · Urgent compliance
              </div>
              <div style="font-family:{FONT_DISPLAY};font-size:24px;line-height:1.25;color:#ffffff;margin-top:10px;font-weight:600;letter-spacing:-0.02em;">
                {count} calibration{'s' if count != 1 else ''} overdue
              </div>
              <div style="font-family:{FONT_SANS};font-size:14px;line-height:1.5;color:rgba(255,255,255,0.86);margin-top:8px;">
                Action required to restore metrology readiness.
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <p style="margin:0 0 16px;font-family:{FONT_SANS};font-size:15px;line-height:1.6;font-weight:500;color:#e5e7eb;">
                Hi {safe_name},
              </p>
              <p style="margin:0 0 18px;font-family:{FONT_SANS};font-size:15px;line-height:1.6;color:#cbd5e1;">
                The following equipment is past its next calibration due date. Please review and schedule verification.
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0b1220;border:1px solid #243044;border-radius:10px;overflow:hidden;">
                <tr>
                  <th align="left" style="padding:10px 14px;font-family:{FONT_SANS};font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;border-bottom:1px solid #243044;">Equipment</th>
                  <th align="left" style="padding:10px 14px;font-family:{FONT_SANS};font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;border-bottom:1px solid #243044;">Due date</th>
                  <th align="right" style="padding:10px 14px;font-family:{FONT_SANS};font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;border-bottom:1px solid #243044;">Status</th>
                </tr>
                {rows_html}
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 0;">
                <tr>
                  <td align="center" style="border-radius:10px;background:#0f766e;">
                    <a href="{safe_cta}" target="_blank" rel="noopener noreferrer"
                       style="display:inline-block;padding:12px 22px;font-family:{FONT_SANS};font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">
                      View overdue equipment
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="border-top:1px solid #1f2a3c;padding:16px 28px 22px;background:#0d1422;">
              <div style="font-family:{FONT_SANS};font-size:12px;font-weight:500;color:#64748b;">
                TrueGage · Manufacturing calibration monitoring
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
"""
    msg = build_message(
        config=config,
        to_email=to_email,
        to_name=to_name,
        subject=subject,
        text_body=text,
        html_body=html,
    )
    send_message(config, msg)
