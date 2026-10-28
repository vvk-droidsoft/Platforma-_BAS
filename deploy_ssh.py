# -*- coding: utf-8 -*-
"""Minimal SSH helper for VPS deploy (password auth)."""
import argparse
import os
import sys

try:
    import paramiko
except ImportError:
    os.system(f'"{sys.executable}" -m pip install paramiko -q')
    import paramiko


def connect(host, user, password=None, key_path=None):
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    kwargs = {"hostname": host, "username": user, "timeout": 30}
    if key_path and os.path.isfile(key_path):
        kwargs["key_filename"] = key_path
    if password:
        kwargs["password"] = password
    c.connect(**kwargs)
    return c


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--host", required=True)
    p.add_argument("--user", default="root")
    p.add_argument("--password", default=os.environ.get("VPS_PASSWORD") or "")
    p.add_argument("--key", default="")
    p.add_argument("--cmd", default="")
    p.add_argument("--put", default="")
    p.add_argument("--remote", default="")
    p.add_argument("--install-key", action="store_true")
    p.add_argument("--pubkey", default="")
    args = p.parse_args()

    if not args.password and not args.key:
        print("Need --password or --key / VPS_PASSWORD", file=sys.stderr)
        sys.exit(2)

    client = connect(args.host, args.user, args.password or None, args.key or None)

    if args.install_key and args.pubkey:
        pub = open(args.pubkey, encoding="utf-8").read().strip()
        cmd = (
            "mkdir -p ~/.ssh && chmod 700 ~/.ssh && "
            f"grep -qxF '{pub}' ~/.ssh/authorized_keys 2>/dev/null || "
            f"echo '{pub}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
        )
        _, stdout, stderr = client.exec_command(cmd)
        code = stdout.channel.recv_exit_status()
        err = stderr.read().decode()
        if code != 0:
            print(err, file=sys.stderr)
            sys.exit(code)
        print("pubkey installed")

    if args.put and args.remote:
        sftp = client.open_sftp()
        sftp.put(args.put, args.remote)
        sftp.close()
        print("uploaded", args.put, "->", args.remote)

    if args.cmd:
        _, stdout, stderr = client.exec_command(args.cmd, get_pty=True)
        out = stdout.read().decode(errors="replace")
        err = stderr.read().decode(errors="replace")
        code = stdout.channel.recv_exit_status()
        sys.stdout.write(out)
        if err:
            sys.stderr.write(err)
        client.close()
        sys.exit(code)

    client.close()


if __name__ == "__main__":
    main()
