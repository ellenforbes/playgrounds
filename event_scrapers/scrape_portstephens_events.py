import requests
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
import re
import os
from supabase import create_client, Client

# School term dates for NSW
SCHOOL_TERM_DATES = {
    2025: {
        "terms": {
            "eastern_nsw": [
                ("Term 1", "2025-02-06", "2025-04-11"),
                ("Term 2", "2025-04-30", "2025-07-04"),
                ("Term 3", "2025-07-22", "2025-09-26"),
                ("Term 4", "2025-10-14", "2025-12-19"),
            ]
        }
    },
    2026: {
        "terms": {
            "eastern_nsw": [
                ("Term 1", "2026-01-27", "2026-04-02"),
                ("Term 2", "2026-04-20", "2026-07-03"),
                ("Term 3", "2026-07-20", "2026-09-25"),
                ("Term 4", "2026-10-12", "2026-12-17"),
            ]
        }
    },
    2027: {
        "terms": {
            "eastern_nsw": [
                ("Term 1", "2027-01-28", "2027-04-09"),
                ("Term 2", "2027-04-26", "2027-07-02"),
                ("Term 3", "2027-07-19", "2027-09-24"),
                ("Term 4", "2027-10-11", "2027-12-20"),
            ]
        }
    }
}

# Library locations with coordinates
LOCATIONS = {
    'tomaree': {
        'name': 'Tomaree Library',
        'latitude': -32.7211,
        'longitude': 152.0794
    },
    'raymond terrace': {
        'name': 'Raymond Terrace Library',
        'latitude': -32.7611,
        'longitude': 151.7444
    },
    'medowie': {
        'name': 'Medowie Library',
        'latitude': -32.7667,
        'longitude': 151.6333
    }
}

def get_weekday_number(day_name):
    """Convert day name to weekday number (0=Monday, 6=Sunday)"""
    days = {
        'monday': 0, 'tuesday': 1, 'wednesday': 2, 'thursday': 3,
        'friday': 4, 'saturday': 5, 'sunday': 6
    }
    return days.get(day_name.lower())

def generate_dates_for_term_schedule(schedule_text, time_text):
    """
    Generate all dates for a term-time recurring event
    Returns list of datetime strings (filtered to future dates within 1 month)
    """
    dates = []
    
    # Get current datetime and calculate cutoff (1 month from now)
    now = datetime.now()
    one_month_later = now + timedelta(days=30)
    
    # Extract day of week from schedule text
    day_match = re.search(r'every\s+(\w+day)', schedule_text.lower())
    if not day_match:
        return dates
    
    day_name = day_match.group(1)
    weekday_num = get_weekday_number(day_name)
    if weekday_num is None:
        return dates
    
    # Check if it's term time or all year
    is_term_time = 'school term' in schedule_text.lower() or 'term' in schedule_text.lower()
    
    # Extract time
    time_match = re.search(r'(\d{1,2}):?(\d{2})?\s*(am|pm)', time_text.lower())
    if not time_match:
        return dates
    
    hour = int(time_match.group(1))
    minute = int(time_match.group(2)) if time_match.group(2) else 0
    period = time_match.group(3)
    
    # Convert to 24-hour format
    if period == 'pm' and hour != 12:
        hour += 12
    elif period == 'am' and hour == 12:
        hour = 0
    
    time_str = f"{hour:02d}:{minute:02d}"
    
    # Generate dates for current year and next year
    current_year = datetime.now().year
    
    for year in [current_year, current_year + 1]:
        if year not in SCHOOL_TERM_DATES:
            continue
        
        if is_term_time:
            # Generate dates for each term
            terms = SCHOOL_TERM_DATES[year]["terms"]["eastern_nsw"]
            for term_name, start_date, end_date in terms:
                start = datetime.strptime(start_date, '%Y-%m-%d')
                end = datetime.strptime(end_date, '%Y-%m-%d')
                
                # Find first occurrence of the weekday in the term
                current = start
                while current.weekday() != weekday_num:
                    current += timedelta(days=1)
                    if current > end:
                        break
                
                # Add all occurrences of that weekday in the term
                while current <= end:
                    event_datetime = datetime.strptime(f"{current.strftime('%Y-%m-%d')} {time_str}", '%Y-%m-%d %H:%M')
                    
                    # Only add if future-dated and within 1 month
                    if now < event_datetime <= one_month_later:
                        dates.append(f"{current.strftime('%Y-%m-%d')} {time_str}")
                    
                    current += timedelta(weeks=1)
        else:
            # All year round - only check the next month
            start = now.date()
            end = one_month_later.date()
            
            current = datetime.combine(start, datetime.min.time())
            while current.weekday() != weekday_num:
                current += timedelta(days=1)
            
            while current.date() <= end:
                event_datetime = datetime.strptime(f"{current.strftime('%Y-%m-%d')} {time_str}", '%Y-%m-%d %H:%M')
                
                # Only add if future-dated and within 1 month
                if now < event_datetime <= one_month_later:
                    dates.append(f"{current.strftime('%Y-%m-%d')} {time_str}")
                
                current += timedelta(weeks=1)
    
    return dates

def parse_location_names(location_text):
    """Parse location text and return list of location keys"""
    location_text_lower = location_text.lower()
    found_locations = []
    
    for key in LOCATIONS.keys():
        if key in location_text_lower:
            found_locations.append(key)
    
    return found_locations if found_locations else ['tomaree']  # Default

def scrape_portstephens_library_events():
    """
    Scrape regular programs from Port Stephens Library website
    """
    url = "https://www.portstephens.nsw.gov.au/services/library/childrens-programs"
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
    
    try:
        print("Fetching Port Stephens library programs...")
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Find the regular programs content
        content_div = soup.find('div', id='content_container_125662')
        
        if not content_div:
            print("Could not find regular programs content")
            return []
        
        events = []
        
        # Find all program sections
        current_title = None
        current_description = None
        current_when = None
        current_where = None
        
        for element in content_div.find_all(['p', 'ul', 'hr']):
            if element.name == 'hr':
                # Process accumulated program
                if current_title and current_when and current_where:
                    # Parse locations
                    location_keys = parse_location_names(current_where)
                    
                    # Generate dates (already filtered to future + 1 month)
                    dates = generate_dates_for_term_schedule(current_when, current_when)
                    
                    # Create event for each location and date
                    for location_key in location_keys:
                        location_data = LOCATIONS[location_key]
                        
                        for date_str in dates:
                            event = {
                                'title': current_title,
                                'description': current_description or '',
                                'datetime': date_str,
                                'location': location_data['name'],
                                'latitude': location_data['latitude'],
                                'longitude': location_data['longitude'],
                                'url': url
                            }
                            events.append(event)
                            print(f"  ✓ {current_title} at {location_data['name']} on {date_str}")
                
                # Reset for next program
                current_title = None
                current_description = None
                current_when = None
                current_where = None
                
            elif element.name == 'p':
                # Check if this is a title (has <strong> tag)
                strong = element.find('strong')
                if strong:
                    current_title = strong.text.strip()
                    # Get description (rest of the paragraph after the strong tag)
                    desc_text = element.get_text(separator=' ', strip=True)
                    # Remove the title from the description
                    current_description = desc_text.replace(current_title, '').strip()
                
            elif element.name == 'ul':
                # Extract when and where from list items
                for li in element.find_all('li'):
                    li_text = li.get_text(strip=True)
                    if li_text.startswith('When:'):
                        current_when = li_text.replace('When:', '').strip()
                    elif li_text.startswith('Where:'):
                        current_where = li_text.replace('Where:', '').strip()
        
        # Process last program (if no trailing hr)
        if current_title and current_when and current_where:
            location_keys = parse_location_names(current_where)
            dates = generate_dates_for_term_schedule(current_when, current_when)
            
            for location_key in location_keys:
                location_data = LOCATIONS[location_key]
                
                for date_str in dates:
                    event = {
                        'title': current_title,
                        'description': current_description or '',
                        'datetime': date_str,
                        'location': location_data['name'],
                        'latitude': location_data['latitude'],
                        'longitude': location_data['longitude'],
                        'url': url
                    }
                    events.append(event)
                    print(f"  ✓ {current_title} at {location_data['name']} on {date_str}")
        
        return events
        
    except requests.RequestException as e:
        print(f"Error fetching webpage: {e}")
        return []

def upload_to_supabase(events, supabase_url, supabase_key, table='events_portstephens'):
    """Upload events to Supabase"""
    if not events:
        print("No events to upload.")
        return

    supabase: Client = create_client(supabase_url, supabase_key)
    columns = ['title', 'description', 'datetime', 'location', 'url', 'latitude', 'longitude']
    clean = [{k: e.get(k) for k in columns} for e in events if 'error' not in e]

    # Delete existing records
    try:
        supabase.table(table).delete().neq('title', '').execute()
        print(f"Cleared existing records from {table}")
    except Exception as e:
        print(f"Warning: Could not clear existing records: {e}")

    # Insert new records
    try:
        supabase.table(table).insert(clean).execute()
        print(f"Uploaded {len(clean)} records to {table}")
    except Exception as e:
        print(f"Error uploading to Supabase: {e}")
        raise

def main():
    """Main function to run the scraper and upload to Supabase"""
    print("Scraping Port Stephens Library events...")
    print("(Filtering to future events within the next month only)")
    print("-" * 80)
    
    # Scrape events
    events = scrape_portstephens_library_events()
    
    if events:
        # Sort events by datetime
        events.sort(key=lambda x: x['datetime'])
        
        print(f"\nGenerated {len(events)} upcoming events (next month)")
        
        # Upload to Supabase
        supabase_url = os.environ.get('SUPABASE_URL')
        supabase_key = os.environ.get('SUPABASE_KEY')
        
        if supabase_url and supabase_key:
            upload_to_supabase(events, supabase_url, supabase_key)
        else:
            print("⚠ Supabase credentials missing. Skipping upload.")
    else:
        print("No upcoming events found in the next month.")

if __name__ == "__main__":
    main()
