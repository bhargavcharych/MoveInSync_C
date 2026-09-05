#!/usr/bin/env python3
"""Build the immutable MoveInSync DuckDB from the supplied CSV files.

The script writes to a temporary database, validates it, atomically replaces the
target, and finally removes write permissions. The web application opens the
result with DuckDB's READ_ONLY access mode.
"""

from __future__ import annotations

import argparse
import os
import stat
from pathlib import Path

import duckdb


DEFAULT_SOURCE = Path("/Users/bhargav/Downloads/MoveInSync - Anonymised Trip-Log Dataset")
DEFAULT_TARGET = Path(__file__).resolve().parents[1] / "data" / "moveinsync.duckdb"


def sql_path(path: Path) -> str:
    return "'" + str(path).replace("'", "''") + "'"


def build(source: Path, target: Path, force: bool) -> None:
    required = [
        source / "Ride_data _trip-may_2026.csv",
        source / "Ride_data _trip-June_2026.csv",
        source / "Ride_data _trip-July_2026.csv",
        source / "emp_Data.csv",
        source / "trip_feedback.csv",
        source / "alerts_data.csv",
        source / "bill_data.csv",
    ]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise SystemExit("Missing source files:\n" + "\n".join(missing))
    if target.exists() and not force:
        raise SystemExit(f"{target} already exists. Pass --force to rebuild it explicitly.")

    target.parent.mkdir(parents=True, exist_ok=True)
    building = target.with_suffix(".building.duckdb")
    if building.exists():
        building.chmod(stat.S_IRUSR | stat.S_IWUSR)
        building.unlink()

    con = duckdb.connect(str(building))
    con.execute("PRAGMA threads=4")
    con.execute("SET preserve_insertion_order=false")
    con.execute("SET enable_progress_bar=true")

    ride_files = ", ".join(sql_path(path) for path in required[:3])
    con.execute(
        f"""
        CREATE TABLE rides AS
        SELECT
          business_unit,
          office,
          product_type,
          try_strptime(trip_date, '%B %-d, %Y')::DATE AS trip_date,
          shift_type,
          try_cast(replace(trip_id, ',', '') AS BIGINT) AS trip_id,
          trip_direction,
          try_cast(actual_escort AS BOOLEAN) AS actual_escort,
          vendor_id,
          nullif(planned_cab_registration, '') AS planned_cab_registration,
          actual_cab_registration,
          try_cast(actual_cab_capacity AS SMALLINT) AS actual_cab_capacity,
          try_cast(replace(planned_km, ',', '') AS DOUBLE) AS planned_km,
          try_cast(replace(traveled_km, ',', '') AS DOUBLE) AS traveled_km,
          try_cast(replace(planned_start_epoch, ',', '') AS BIGINT) AS planned_start_epoch,
          try_cast(replace(planned_end_epoch, ',', '') AS BIGINT) AS planned_end_epoch,
          try_cast(replace(actual_start_epoch, ',', '') AS BIGINT) AS actual_start_epoch,
          try_cast(replace(actual_end_epoch, ',', '') AS BIGINT) AS actual_end_epoch,
          delay_reason,
          try_cast(replace(delay_minutes, ',', '') AS INTEGER) AS delay_minutes,
          route_source,
          actual_cab_fuel_type,
          try_cast(is_driver_nc AS BOOLEAN) AS is_driver_nc,
          try_cast(is_cab_nc AS BOOLEAN) AS is_cab_nc,
          nullif(trip_nodal, 'NA') AS trip_nodal,
          try_cast(plannedemployee_cnt AS SMALLINT) AS plannedemployee_cnt,
          try_cast(actualemployee_cnt AS SMALLINT) AS actualemployee_cnt,
          try_cast(noshow_cnt AS SMALLINT) AS noshow_cnt
        FROM read_csv([{ride_files}], header=true, all_varchar=true, union_by_name=true)
        """
    )

    con.execute(
        f"""
        CREATE TABLE employees AS
        SELECT
          business_unit,
          office,
          product_type,
          try_cast(trip_date AS DATE) AS trip_date,
          shift_type,
          try_cast(trip_id AS BIGINT) AS trip_id,
          try_cast(planned_pickup_epoch AS BIGINT) AS planned_pickup_epoch,
          try_cast(planned_drop_epoch AS BIGINT) AS planned_drop_epoch,
          try_cast(actual_pickup_epoch AS BIGINT) AS actual_pickup_epoch,
          try_cast(actual_drop_epoch AS BIGINT) AS actual_drop_epoch,
          try_cast(planned_km AS DOUBLE) AS planned_km,
          try_cast(traveled_km AS DOUBLE) AS traveled_km,
          try_cast(stwid AS BIGINT) AS stwid,
          nullif(signintype, '') AS signintype,
          nullif(gender, '') AS gender,
          nullif(emp_role, '') AS emp_role,
          boarding_status,
          nullif(not_boarding_reason, '') AS not_boarding_reason,
          try_cast(is_no_show AS BOOLEAN) AS is_no_show,
          coalesce(try_cast(planned_km AS DOUBLE) < 0, false)
            OR coalesce(try_cast(traveled_km AS DOUBLE) < 0, false) AS has_invalid_distance
        FROM read_csv({sql_path(required[3])}, header=true, all_varchar=true)
        """
    )

    con.execute(
        f"""
        CREATE TABLE feedback AS
        SELECT
          business_unit,
          try_cast(replace(trip_id, ',', '') AS BIGINT) AS trip_id,
          trip_type,
          try_strptime(trip_date, '%B %-d, %Y, %-I:%M %p') AS trip_date,
          try_cast(replace(stwid, ',', '') AS BIGINT) AS stwid,
          try_cast(route_rating AS UTINYINT) AS route_rating,
          try_cast(driver_rating AS UTINYINT) AS driver_rating,
          try_cast(cab_rating AS UTINYINT) AS cab_rating,
          try_cast(safety_rating AS UTINYINT) AS safety_rating,
          try_cast(marshal_rating AS UTINYINT) AS marshal_rating,
          try_strptime(creation_time, '%B %-d, %Y, %-I:%M %p') AS creation_time
        FROM read_csv({sql_path(required[4])}, header=true, all_varchar=true)
        """
    )

    con.execute(
        f"""
        CREATE TABLE alerts AS
        SELECT
          business_unit,
          try_cast(replace(trip_id, ',', '') AS BIGINT) AS trip_id,
          try_cast(replace(stwid, ',', '') AS BIGINT) AS stwid,
          try_cast(event_id AS UUID) AS event_id,
          event_type,
          try_strptime(start_time, '%B %-d, %Y, %-I:%M %p') AS start_time,
          try_strptime(acknowledge_time, '%B %-d, %Y, %-I:%M %p') AS acknowledge_time,
          state_text,
          CASE WHEN severity IN ('Sev-1', 'Sev-2', 'Sev-3') THEN severity END AS severity,
          nullif(source, '') AS source,
          severity = 'False' AS had_invalid_severity
        FROM read_csv({sql_path(required[5])}, header=true, all_varchar=true)
        """
    )

    con.execute(
        f"""
        CREATE TABLE bills AS
        SELECT
          business_unit,
          office,
          vendor,
          try_strptime(cycle_start, '%B %-d, %Y, %-I:%M %p') AS cycle_start,
          try_strptime(cycle_end, '%B %-d, %Y, %-I:%M %p') AS cycle_end,
          try_cast(replace(trip_id, ',', '') AS BIGINT) AS trip_id,
          trip_id = 'OverHead' AS is_overhead,
          nullif(contract, '') AS contract,
          nullif(slab_name, '') AS slab_name,
          try_cast(total_trip_km AS DOUBLE) AS total_trip_km,
          try_cast(replace(trip_cost, ',', '') AS DOUBLE) AS trip_cost
        FROM read_csv({sql_path(required[6])}, header=true, all_varchar=true)
        """
    )

    # trip_id is only unique inside a business unit (6,753 IDs overlap across
    # tenants), so every index and join deliberately uses the composite key.
    con.execute("CREATE UNIQUE INDEX rides_trip_id_idx ON rides(business_unit, trip_id)")
    con.execute("CREATE INDEX employees_trip_id_idx ON employees(business_unit, trip_id)")
    con.execute("CREATE INDEX feedback_trip_id_idx ON feedback(business_unit, trip_id)")
    con.execute("CREATE INDEX alerts_trip_id_idx ON alerts(business_unit, trip_id)")
    con.execute("CREATE INDEX bills_trip_id_idx ON bills(business_unit, trip_id)")

    con.execute(
        """
        CREATE VIEW v_trip_facts AS
        WITH bill_by_trip AS (
          SELECT business_unit, trip_id, sum(trip_cost) AS trip_cost, sum(total_trip_km) AS billed_km,
                 any_value(contract) AS contract, any_value(slab_name) AS slab_name
          FROM bills GROUP BY business_unit, trip_id
        ), feedback_by_trip AS (
          SELECT business_unit, trip_id,
            sum(CASE WHEN route_rating > 0 THEN route_rating ELSE 0 END
              + CASE WHEN driver_rating > 0 THEN driver_rating ELSE 0 END
              + CASE WHEN cab_rating > 0 THEN cab_rating ELSE 0 END
              + CASE WHEN safety_rating > 0 THEN safety_rating ELSE 0 END
              + CASE WHEN marshal_rating > 0 THEN marshal_rating ELSE 0 END)::DOUBLE /
            nullif(sum((route_rating > 0)::INTEGER + (driver_rating > 0)::INTEGER
              + (cab_rating > 0)::INTEGER + (safety_rating > 0)::INTEGER
              + (marshal_rating > 0)::INTEGER), 0) AS csat,
            avg(nullif(driver_rating, 0)) AS driver_rating,
            avg(nullif(safety_rating, 0)) AS safety_rating,
            count(*) AS feedback_count
          FROM feedback GROUP BY business_unit, trip_id
        ), alert_by_trip AS (
          SELECT business_unit, trip_id, count(*) AS alert_count,
            count(*) FILTER (WHERE severity = 'Sev-1') AS sev1_count,
            count(*) FILTER (WHERE state_text IN ('OPEN', 'NEW')) AS open_alert_count
          FROM alerts GROUP BY business_unit, trip_id
        )
        SELECT r.*,
          (r.actual_end_epoch - r.planned_end_epoch) / 60.0 AS arrival_delay_minutes,
          (r.actual_start_epoch - r.planned_start_epoch) / 60.0 AS pickup_delay_minutes,
          (r.actual_end_epoch <= r.planned_end_epoch + 15 * 60) AS is_ota,
          (r.actual_start_epoch <= r.planned_start_epoch + 10 * 60) AS is_otp,
          r.actualemployee_cnt::DOUBLE / nullif(r.actual_cab_capacity, 0) AS utilization,
          b.trip_cost,
          b.billed_km,
          b.trip_cost / nullif(b.billed_km, 0) AS cost_per_km,
          b.contract,
          b.slab_name,
          f.csat,
          f.driver_rating,
          f.safety_rating,
          coalesce(f.feedback_count, 0) AS feedback_count,
          coalesce(a.alert_count, 0) AS alert_count,
          coalesce(a.sev1_count, 0) AS sev1_count,
          coalesce(a.open_alert_count, 0) AS open_alert_count
        FROM rides r
        LEFT JOIN bill_by_trip b USING (business_unit, trip_id)
        LEFT JOIN feedback_by_trip f USING (business_unit, trip_id)
        LEFT JOIN alert_by_trip a USING (business_unit, trip_id)
        """
    )

    expected = {
        "rides": 615_546,
        "employees": 1_637_906,
        "feedback": 512_873,
        "alerts": 51_699,
        "bills": 620_942,
    }
    for table, expected_count in expected.items():
        count = con.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
        if count != expected_count:
            raise RuntimeError(f"{table}: expected {expected_count:,} rows, found {count:,}")
        print(f"✓ {table:10s} {count:>10,} rows")

    null_trip_ids = {
        table: con.execute(f"SELECT count(*) FROM {table} WHERE trip_id IS NULL").fetchone()[0]
        for table in expected
    }
    if any(null_trip_ids[table] for table in ("rides", "employees", "feedback", "alerts")):
        raise RuntimeError(f"Found invalid trip IDs: {null_trip_ids}")
    if null_trip_ids["bills"] != 160:
        raise RuntimeError(f"Expected 160 labelled overhead bill rows; found {null_trip_ids['bills']}")
    print("✓ preserved 160 non-trip overhead bill lines with is_overhead=true")

    con.execute("CHECKPOINT")
    con.close()

    if target.exists():
        target.chmod(stat.S_IRUSR | stat.S_IWUSR)
        target.unlink()
    os.replace(building, target)
    target.chmod(stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)
    print(f"\nLocked read-only database: {target} ({target.stat().st_size / 1024**2:.1f} MiB)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--target", type=Path, default=DEFAULT_TARGET)
    parser.add_argument("--force", action="store_true", help="explicitly replace an existing database")
    args = parser.parse_args()
    build(args.source.expanduser().resolve(), args.target.expanduser().resolve(), args.force)


if __name__ == "__main__":
    main()
