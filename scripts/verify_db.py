#!/usr/bin/env python3
from pathlib import Path

import duckdb


db = Path(__file__).resolve().parents[1] / "data" / "moveinsync.duckdb"
if not db.exists():
    raise SystemExit(f"Database not found: {db}. Run npm run db:ingest first.")

con = duckdb.connect(str(db), read_only=True)
print(f"Read-only: {db}")
for table in ["rides", "employees", "feedback", "alerts", "bills"]:
    count = con.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
    print(f"{table:10s} {count:>10,}")

print("\nCoverage")
row = con.execute(
    """
    SELECT min(trip_date), max(trip_date), count(DISTINCT vendor_id),
      count(DISTINCT office), round(100 * avg(is_ota::INTEGER), 2)
    FROM v_trip_facts
    """
).fetchone()
print(f"{row[0]} → {row[1]} · {row[2]} vendors · {row[3]} offices · OTA {row[4]}%")
con.close()
