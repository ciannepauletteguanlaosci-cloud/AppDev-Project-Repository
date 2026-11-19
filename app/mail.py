"""Password recovery email over authenticated TLS SMTP."""
import os
import smtplib
import ssl
from email.message import EmailMessage


def settings():
    host = os.getenv('SMTP_HOST', '').strip()
    username = os.getenv('SMTP_USERNAME', '').strip()
    password = os.getenv('SMTP_PASSWORD', '')
    sender = os.getenv('SMTP_FROM', '').strip()
    security = os.getenv('SMTP_SECURITY', 'starttls').strip().lower()
    try:
        port = int(os.getenv('SMTP_PORT', '587'))
    except ValueError:
        return None
    if (not all((host, username, password, sender)) or '@' not in sender
            or any(ch in host+username+sender for ch in '\r\n')
            or security not in ('starttls', 'ssl') or not 1 <= port <= 65535):
        return None
    return host, port, username, password, sender, security


def send_reset_code(recipient, code):
    config = settings()
    if not config:
        raise ValueError('Email sender is not configured.')
    host, port, username, password, sender, security = config
    message = EmailMessage()
    message['Subject'] = 'Your Penny Wais password reset code'
    message['From'] = sender
    message['To'] = recipient
    message.set_content(
        f'Your Penny Wais password reset code is:\n\n{code}\n\n'
        'Enter this code in the app to choose a new password. '
        'It expires in 15 minutes and can be used once.\n\n'
        'If you did not request this, ignore this email. Your password has not changed. '
        'Do not share this code with anyone.\n'
    )
    context = ssl.create_default_context()
    if security == 'ssl':
        connection = smtplib.SMTP_SSL(host, port, timeout=15, context=context)
    else:
        connection = smtplib.SMTP(host, port, timeout=15)
    with connection as smtp:
        if security == 'starttls':
            smtp.ehlo()
            smtp.starttls(context=context)
            smtp.ehlo()
        smtp.login(username, password)
        if smtp.send_message(message):
            raise smtplib.SMTPException('Recipient was refused.')
