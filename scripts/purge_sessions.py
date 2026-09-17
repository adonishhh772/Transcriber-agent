#!/usr/bin/env python3
import os, time
from pathlib import Path
from argparse import ArgumentParser

def main():
    ap = ArgumentParser(description="Purge old session NDJSON logs")
    ap.add_argument("--base", default=os.getenv("DATA_DIR", "./data/sessions"))
    ap.add_argument("--days", type=int, default=int(os.getenv("RETENTION_DAYS", "7")))
    args = ap.parse_args()

    root = Path(args.base)
    if not root.exists():
        print(f"{root} does not exist")
        return

    cutoff = time.time() - args.days * 86400
    removed = 0
    for p in root.glob("*.ndjson"):
        try:
            if p.stat().st_mtime < cutoff:
                p.unlink()
                removed += 1
        except Exception as e:
            print(f"Skip {p}: {e}")
    print(f"Purged {removed} old session files from {root}")

if __name__ == "__main__":
    main()
