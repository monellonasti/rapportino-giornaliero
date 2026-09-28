"""Stampa definitiva: registro dei rapportini chiusi, email al gestore e stampa."""
import hashlib
import json
import os
import smtplib
import ssl
import stat
import subprocess
import sys
from dataclasses import dataclass
from email.message import EmailMessage
from pathlib import Path

XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'


@dataclass
class SmtpSettings:
    host: str
    port: int
    secure: bool
    user: str
    password: str
    sender: str
    manager: str

    @classmethod
    def from_env(cls, env=None):
        env = os.environ if env is None else env
        manager = env.get('EMAIL_GESTORE') or env.get('EMAIL_TO')
        missing = [k for k in ('SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'EMAIL_FROM') if not env.get(k)]
        if not manager:
            missing.append('EMAIL_GESTORE')
        if missing:
            raise ValueError('Per la stampa definitiva configura nel file .env: ' + ', '.join(missing))
        return cls(
            host=env['SMTP_HOST'],
            port=int(env.get('SMTP_PORT') or 587),
            secure=(env.get('SMTP_SECURE') or 'false').lower() == 'true',
            user=env['SMTP_USER'],
            password=env['SMTP_PASSWORD'],
            sender=env['EMAIL_FROM'],
            manager=manager,
        )


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class Registry:
    """Registro JSON dei definitivi: file, impronta, esito email e stampe."""

    def __init__(self, folder):
        self.path = Path(folder) / 'registro.json'
        self.data = json.loads(self.path.read_text('utf-8')) if self.path.exists() else {}

    def get(self, date):
        return self.data.get(date)

    def set(self, date, entry):
        self.data[date] = entry
        self.save()

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix('.tmp')
        tmp.write_text(json.dumps(self.data, indent=2, ensure_ascii=False), 'utf-8')
        os.replace(tmp, self.path)


def make_read_only(path):
    os.chmod(path, stat.S_IREAD | stat.S_IRGRP | stat.S_IROTH)


def send_to_manager(settings, path, subject, body):
    message = EmailMessage()
    message['Subject'] = subject
    message['From'] = settings.sender
    message['To'] = settings.manager
    message.set_content(body)
    maintype, subtype = XLSX.split('/')
    message.add_attachment(Path(path).read_bytes(), maintype=maintype, subtype=subtype, filename=Path(path).name)
    context = ssl.create_default_context()
    if settings.secure:
        with smtplib.SMTP_SSL(settings.host, settings.port, context=context, timeout=30) as smtp:
            smtp.login(settings.user, settings.password)
            smtp.send_message(message)
    else:
        with smtplib.SMTP(settings.host, settings.port, timeout=30) as smtp:
            smtp.starttls(context=context)
            smtp.login(settings.user, settings.password)
            smtp.send_message(message)


def print_file(path):
    """Invia il file alla stampante predefinita con il programma associato (Excel su Windows)."""
    if sys.platform == 'win32':
        os.startfile(str(path), 'print')
    else:
        subprocess.run(['lp', str(path)], check=True)
