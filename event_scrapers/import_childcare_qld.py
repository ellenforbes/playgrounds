"""
import_childcare_qld.py
──────────────────────────────────────────────────────────────────────────────
Downloads the ACECQA Queensland services CSV, geocodes new addresses via
Nominatim (using a Supabase-persisted cache so only NEW addresses hit the
API), computes NQS scores, then truncates and reloads childcare_queensland.

Environment variables required:
    SUPABASE_URL   — your Supabase project URL
    SUPABASE_KEY   — your Supabase service role or anon key

Tables used:
    childcare_queensland  — main data table (truncated + reloaded each run)
    geocode_cache         — persisted address → lat/lng lookup (append-only)
──────────────────────────────────────────────────────────────────────────────
"""

import csv
import io
import os
import time
import urllib.request
import urllib.parse
from datetime import datetime
from supabase import create_client, Client

# ── Config ────────────────────────────────────────────────────────────────────

CSV_URL = (
    'https://www.acecqa.gov.au/sites/default/files/national-registers/'
    'services/Education-services-qld-export.csv'
)

NOMINATIM_URL   = 'https://nominatim.openstreetmap.org/search'
NOMINATIM_AGENT = 'PlaygroundFinderMap/1.0 (contact@yoursite.com.au)'
GEOCODE_DELAY   = 1.1   # seconds between Nominatim requests (rate limit: 1/s)

BATCH_SIZE      = 200   # rows per Supabase insert batch
TABLE_CHILDCARE = 'childcare_queensland'
TABLE_GEOCACHE  = 'geocode_cache'

# ── NQS rating → numeric score ────────────────────────────────────────────────

RATING_SCORE = {
    'Significant Improvement Required': 0,
    'Working Towards NQS':              1,
    'Meeting NQS':                      2,
    'Exceeding NQS':                    3,
    'Excellent':                        4,
}

def rating_to_score(value: str) -> int:
    return RATING_SCORE.get((value or '').strip(), 0)

def compute_score(row: dict) -> int:
    """Sum of QA1–QA7 ratings (max 28, or 32 if any area is Excellent)."""
    fields = [
        'QualityArea1Rating', 'QualityArea2Rating', 'QualityArea3Rating',
        'QualityArea4Rating', 'QualityArea5Rating', 'QualityArea6Rating',
        'QualityArea7Rating',
    ]
    return sum(rating_to_score(row.get(f, '')) for f in fields)

# ── CSV column → Supabase column mapping ─────────────────────────────────────

COL_MAP = {
    'ServiceApprovalNumber':                        'service_approval_number',
    'Provider Approval Number':                     'provider_approval_number',
    'ServiceName':                                  'service_name',
    'ProviderLegalName':                            'provider_legal_name',
    'ServiceType':                                  'service_type',
    'ServiceAddress':                               'service_address',
    'Suburb':                                       'suburb',
    'State':                                        'state',
    'Postcode':                                     'postcode',
    'Conditions on Approval':                       'conditions_on_approval',
    'NumberOfApprovedPlaces':                       'number_of_approved_places',
    'ServiceApprovalGrantedDate':                   'service_approval_granted_date',
    'QualityArea1Rating':                           'quality_area_1_rating',
    'QualityArea2Rating':                           'quality_area_2_rating',
    'QualityArea3Rating':                           'quality_area_3_rating',
    'QualityArea4Rating':                           'quality_area_4_rating',
    'QualityArea5Rating':                           'quality_area_5_rating',
    'QualityArea6Rating':                           'quality_area_6_rating',
    'QualityArea7Rating':                           'quality_area_7_rating',
    'OverallRating':                                'overall_rating',
    'RatingsIssued':                                'ratings_issued',
    'Long Day Care':                                'long_day_care',
    'Preschool/Kindergarten - Part of a School':    'preschool_kindergarten_part_of_school',
    'Preschool/Kindergarten - Stand alone':         'preschool_kindergarten_stand_alone',
    'Outside school Hours Care - After School':     'outside_school_hours_care_after_school',
    'Outside school Hours Care - Before School':    'outside_school_hours_care_before_school',
    'Outside school Hours Care - Vacation Care':    'outside_school_hours_care_vacation_care',
    'Other':                                        'other',
    'Temporarily Closed':                           'temporarily_closed',
}

# ── Geocoding ─────────────────────────────────────────────────────────────────

def make_address_key(row: dict) -> str:
    addr    = (row.get('ServiceAddress') or '').strip().lower()
    suburb  = (row.get('Suburb')         or '').strip().lower()
    postcode = (row.get('Postcode')      or '').strip()
    return f"{addr}|{suburb}|{postcode}"

def geocode_address(address: str, suburb: str, state: str, postcode: str) -> tuple:
    """Call Nominatim, try full address then suburb fallback. Returns (lat, lng) or (None, None)."""
    for query in [
        f"{address}, {suburb} {state} {postcode}, Australia",
        f"{suburb} {state} {postcode}, Australia",
    ]:
        params  = urllib.parse.urlencode({'q': query, 'format': 'json', 'limit': '1', 'countrycodes': 'au'})
        url     = f"{NOMINATIM_URL}?{params}"
        req     = urllib.request.Request(url, headers={'User-Agent': NOMINATIM_AGENT})
        try:
            time.sleep(GEOCODE_DELAY)
            with urllib.request.urlopen(req, timeout=10) as resp:
                import json
                results = json.loads(resp.read().decode())
                if results:
                    return float(results[0]['lat']), float(results[0]['lon'])
        except Exception as e:
            print(f"  ⚠ Nominatim error for '{query}': {e}")
    return None, None

# ── Supabase helpers ──────────────────────────────────────────────────────────

def load_geocode_cache(supabase: Client) -> dict:
    """Load all cached geocodes into a dict keyed by address_key."""
    cache = {}
    # Paginate through entire cache table
    page_size = 1000
    offset    = 0
    while True:
        rows = (
            supabase.table(TABLE_GEOCACHE)
            .select('address_key, latitude, longitude')
            .range(offset, offset + page_size - 1)
            .execute()
        ).data
        for row in rows:
            cache[row['address_key']] = (row['latitude'], row['longitude'])
        if len(rows) < page_size:
            break
        offset += page_size
    print(f"  Loaded {len(cache)} entries from geocode cache")
    return cache

def save_geocode_cache(supabase: Client, new_entries: list):
    """Upsert new geocode entries into cache table."""
    if not new_entries:
        return
    for i in range(0, len(new_entries), BATCH_SIZE):
        supabase.table(TABLE_GEOCACHE).upsert(
            new_entries[i:i + BATCH_SIZE],
            on_conflict='address_key'
        ).execute()
    print(f"  Saved {len(new_entries)} new geocodes to cache")

def insert_childcare(supabase: Client, rows: list):
    """Truncate table then insert all rows in batches."""
    print(f"\nTruncating {TABLE_CHILDCARE}...")
    supabase.table(TABLE_CHILDCARE).delete().neq('id', 0).execute()

    print(f"Inserting {len(rows)} rows in batches of {BATCH_SIZE}...")
    total = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        supabase.table(TABLE_CHILDCARE).insert(batch).execute()
        total += len(batch)
        print(f"  ✓ {total}/{len(rows)}")
    print(f"Insert complete.")

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=" * 65)
    print("ACECQA QLD Childcare Import")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 65)

    # ── Supabase client ───────────────────────────────────────────────────────
    supabase_url = os.environ['SUPABASE_URL']
    supabase_key = os.environ['SUPABASE_KEY']
    supabase: Client = create_client(supabase_url, supabase_key)

    # ── Download CSV ──────────────────────────────────────────────────────────
    print(f"\nDownloading CSV from ACECQA...")
    req = urllib.request.Request(CSV_URL, headers={'User-Agent': NOMINATIM_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read().decode('utf-8-sig')   # strip BOM if present
    print(f"  Downloaded {len(raw):,} bytes")

    reader   = csv.DictReader(io.StringIO(raw))
    csv_rows = list(reader)
    print(f"  Parsed {len(csv_rows):,} rows")

    # ── Load geocode cache from Supabase ──────────────────────────────────────
    print("\nLoading geocode cache from Supabase...")
    geo_cache    = load_geocode_cache(supabase)
    new_geocodes = []   # entries to save back after this run
    geocode_hits = 0
    geocode_miss = 0
    geocode_fail = 0

    # ── Build output rows ─────────────────────────────────────────────────────
    print("\nProcessing rows...")
    output_rows = []

    for i, raw_row in enumerate(csv_rows):
        # Map CSV columns → Supabase columns
        row = {}
        for csv_col, db_col in COL_MAP.items():
            val = raw_row.get(csv_col, '').strip()
            row[db_col] = val if val else None

        # Coerce integer fields
        for int_field in ('number_of_approved_places',):
            try:
                row[int_field] = int(row[int_field]) if row[int_field] else None
            except (ValueError, TypeError):
                row[int_field] = None

        # Coerce date fields
        for date_field in ('service_approval_granted_date',):
            val = row.get(date_field)
            if val:
                for fmt in ('%d/%m/%Y', '%Y-%m-%d', '%d-%m-%Y'):
                    try:
                        row[date_field] = datetime.strptime(val, fmt).date().isoformat()
                        break
                    except ValueError:
                        continue
                else:
                    row[date_field] = None

        # Compute NQS score
        row['score'] = compute_score(raw_row)

        # ── Geocode ───────────────────────────────────────────────────────────
        key = make_address_key(raw_row)
        if key in geo_cache:
            lat, lng = geo_cache[key]
            geocode_hits += 1
        else:
            if i % 50 == 0:
                print(f"  Geocoding row {i+1}/{len(csv_rows)}...")
            lat, lng = geocode_address(
                raw_row.get('ServiceAddress', ''),
                raw_row.get('Suburb',         ''),
                raw_row.get('State',          'QLD'),
                raw_row.get('Postcode',       ''),
            )
            if lat is not None:
                geo_cache[key] = (lat, lng)
                new_geocodes.append({
                    'address_key': key,
                    'latitude':    lat,
                    'longitude':   lng,
                })
                geocode_miss += 1
            else:
                geocode_fail += 1

        row['latitude']  = lat
        row['longitude'] = lng
        output_rows.append(row)

    print(f"\nGeocode summary:")
    print(f"  Cache hits  : {geocode_hits}")
    print(f"  New geocodes: {geocode_miss}")
    print(f"  Failed      : {geocode_fail}")

    # ── Save new geocodes back to Supabase cache ──────────────────────────────
    print("\nSaving new geocodes to cache...")
    save_geocode_cache(supabase, new_geocodes)

    # ── Truncate + insert childcare table ─────────────────────────────────────
    insert_childcare(supabase, output_rows)

    print("\n" + "=" * 65)
    print("IMPORT COMPLETE")
    print(f"Finished: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Total rows imported: {len(output_rows):,}")
    print("=" * 65)


if __name__ == '__main__':
    main()
