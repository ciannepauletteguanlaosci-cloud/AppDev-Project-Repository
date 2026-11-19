"""Local administrator and consistent SQLite backup commands."""
import argparse
import sqlite3
from pathlib import Path
from app.main import DB, db, create_reset_code

parser=argparse.ArgumentParser(description=__doc__)
sub=parser.add_subparsers(dest='command',required=True)
admin=sub.add_parser('admin',help='Promote an existing account')
admin.add_argument('email')
backup=sub.add_parser('backup',help='Back up the database without stopping the app')
backup.add_argument('destination')
reset=sub.add_parser('reset-code',help='Issue a 15-minute password reset code after verifying the account owner')
reset.add_argument('email')
a=parser.parse_args()
if a.command=='admin':
    with db() as c:
        r=c.execute("UPDATE users SET role='admin' WHERE email=?",(a.email.strip().lower(),))
        if r.rowcount!=1:
            raise SystemExit('Account not found. Register it in the app first.')
    print('Administrator access granted. Refresh the app to see Administration.')
elif a.command=='reset-code':
    with db() as c:
        user=c.execute('SELECT id,active FROM users WHERE email=?',(a.email.strip().lower(),)).fetchone()
    if not user:
        raise SystemExit('Account not found.')
    if not user['active']:
        raise SystemExit('Enable this account before issuing a reset code.')
    result=create_reset_code(user['id'])
    print('Reset code:',result['code'])
    print('Expires in 15 minutes. Give it only to the verified account owner.')
    print('Open Forgot password? on the sign-in page to set a new password.')
else:
    dest=Path(a.destination)
    if dest.exists():
        raise SystemExit('Destination already exists. Choose a new backup filename.')
    dest.parent.mkdir(parents=True,exist_ok=True)
    with sqlite3.connect(DB) as source,sqlite3.connect(dest) as target:
        source.backup(target)
    print('Backup created:',dest)
