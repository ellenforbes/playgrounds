import requests
from bs4 import BeautifulSoup
from datetime import datetime
import re
import os
from supabase import create_client, Client

# Singleton Library coordinates
SINGLETON_COORDINATES = {
    'latitude': -32.5667,
    'longitude': 151.1667
}

FAMILY_KEYWORDS = [
    'family', 'toddler', 'babies', 'baby', 'bubs', 'bubba', 'mummabubba',
    'kids', 'teen', 'art starter', 'art play', 'art explorers', 'storytime',
    'rhymetime', 'dungeons', 'lego', 'code', 'stem', 'steam', 'children',
    'school holiday', 'playgroup', 'rock', 'rhyme', 'story stomp', 'little ones'
]


def extract_time_from_description(description):
    """
    Extract the first time mentioned in the description
    Returns time string in HH:MM format or None
    """
    if not description:
        return None
    
    # Pattern to match various time formats:
    # - 10am, 10:30am, 10.30am
    # - 10 am, 10:30 am, 10.30 am
    # - 3.30 - 4.30pm (takes the first time)
    time_patterns = [
        r'(\d{1,2}):(\d{2})\s*(am|pm)',  # 10:30am or 10:30 am
        r'(\d{1,2})\.(\d{2})\s*(am|pm)',  # 10.30am or 10.30 am
        r'(\d{1,2})\s*(am|pm)',           # 10am or 10 am
    ]
    
    for pattern in time_patterns:
        match = re.search(pattern, description.lower())
        if match:
            groups = match.groups()
            if len(groups) == 3:  # Hour, minute, am/pm
                hour = int(groups[0])
                minute = int(groups[1])
                period = groups[2]
            else:  # Hour, am/pm (no minutes)
                hour = int(groups[0])
                minute = 0
                period = groups[1]
            
            # Convert to 24-hour format
            if period == 'pm' and hour != 12:
                hour += 12
            elif period == 'am' and hour == 12:
                hour = 0
            
            return f"{hour:02d}:{minute:02d}"
    
    return None


def scrape_singleton_library_events():
    """
    Scrape events from Singleton Library website and filter for family/children events
    """
    
    url = "https://www.singleton.nsw.gov.au/Live/Residents/Library/Whats-on-at-the-Library"
    
    try:
        # Fetch the webpage
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        
        # Parse HTML
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Find all event items
        events = []
        event_items = soup.find_all('div', class_='list-item-container')
        print(f"Found {len(event_items)} total events")
        
        for item in event_items:
            try:
                # Extract title
                title_elem = item.find('h3', class_='list-item-title')
                if not title_elem:
                    continue
                title = title_elem.text.strip()
                
                # Check if title contains any keyword (case-insensitive)
                if not any(keyword.lower() in title.lower() for keyword in FAMILY_KEYWORDS):
                    continue
                
                # Extract description
                desc_elem = item.find('span', class_='list-item-block-desc')
                description = desc_elem.text.strip() if desc_elem else ''
                
                # Extract date
                date_elem = item.find('span', class_='list-item-block-date')
                datetime_str = ''
                
                if date_elem:
                    day = date_elem.find('span', class_='part-date')
                    month = date_elem.find('span', class_='part-month')
                    year = date_elem.find('span', class_='part-year')
                    
                    if day and month and year:
                        date_str = f"{day.text.strip()} {month.text.strip()} {year.text.strip()}"
                        try:
                            # Parse date to datetime object
                            event_date = datetime.strptime(date_str, '%d %b %Y')
                            
                            # Try to extract time from description
                            time_str = extract_time_from_description(description)
                            if time_str:
                                # Combine date and time
                                datetime_str = f"{event_date.strftime('%Y-%m-%d')} {time_str}"
                            else:
                                # Just date, default to 10:00
                                datetime_str = f"{event_date.strftime('%Y-%m-%d')} 10:00"
                        except Exception as e:
                            print(f"  ⚠ Error parsing date '{date_str}': {e}")
                            continue
                
                if not datetime_str:
                    continue
                
                # Extract event URL for more details
                link_elem = item.find('a', href=True)
                event_url = link_elem['href'] if link_elem else ''
                if event_url and not event_url.startswith('http'):
                    event_url = f"https://www.singleton.nsw.gov.au{event_url}"
                
                # Create event dictionary
                event = {
                    'title': title,
                    'description': description,
                    'datetime': datetime_str,
                    'location': 'Singleton Library',
                    'latitude': SINGLETON_COORDINATES['latitude'],
                    'longitude': SINGLETON_COORDINATES['longitude'],
                    'url': event_url
                }
                
                events.append(event)
                print(f"  ✓ {title}")
                
            except Exception as e:
                print(f"  ⚠ Error parsing event: {e}")
                continue
        
        return events
    
    except requests.RequestException as e:
        print(f"Error fetching webpage: {e}")
        return []


def upload_to_supabase(events, supabase_url, supabase_key, table='events_singleton'):
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
    print("Scraping Singleton Library events...")
    print("-" * 80)
    
    # Scrape events
    events = scrape_singleton_library_events()
    
    if events:
        print(f"\nFound {len(events)} family/children events")
        
        # Upload to Supabase
        supabase_url = os.environ.get('SUPABASE_URL')
        supabase_key = os.environ.get('SUPABASE_KEY')
        
        if supabase_url and supabase_key:
            upload_to_supabase(events, supabase_url, supabase_key)
        else:
            print("⚠ Supabase credentials missing. Skipping upload.")
    else:
        print("No matching events found.")


if __name__ == "__main__":
    main()
