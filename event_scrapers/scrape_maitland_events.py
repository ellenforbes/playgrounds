import requests
from bs4 import BeautifulSoup
import re
import os
from datetime import datetime, timedelta
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from supabase import create_client, Client
import time

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

# Branch coordinates
BRANCH_COORDINATES = {
    "East Maitland": {"latitude": -32.7563, "longitude": 151.5944},
    "Maitland": {"latitude": -32.7306, "longitude": 151.5581},
    "Rutherford": {"latitude": -32.7167, "longitude": 151.5333},
    "Thornton": {"latitude": -32.7833, "longitude": 151.6333}
}

class CombinedMaitlandLibraryScraper:
    def __init__(self, use_selenium=True):
        self.base_url = "https://www.maitlandlibrary.com.au"
        self.api_url = "https://maitlandapi.wpengine.com/wp-json/wp/v2/event?share_entity=1012&per_page=100&page=1&product_type=1184"
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        self.today = datetime.now()
        self.future_limit = self.today + timedelta(days=30)
        self.use_selenium = use_selenium
        self.driver = None
        
        if use_selenium:
            self.setup_selenium()
    
    def setup_selenium(self):
        """Setup Selenium WebDriver"""
        chrome_options = Options()
        chrome_options.add_argument('--headless')
        chrome_options.add_argument('--no-sandbox')
        chrome_options.add_argument('--disable-dev-shm-usage')
        chrome_options.add_argument('--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
        
        try:
            self.driver = webdriver.Chrome(options=chrome_options)
            print("✓ Selenium WebDriver initialized")
        except Exception as e:
            print(f"⚠ Could not initialize Selenium: {e}")
            self.use_selenium = False
    
    def close_selenium(self):
        """Close Selenium WebDriver"""
        if self.driver:
            self.driver.quit()
    
    def get_term_dates_for_day(self, day_of_week):
        """Get all future dates for a specific day of week within term times"""
        days_map = {
            'monday': 0, 'tuesday': 1, 'wednesday': 2, 'thursday': 3,
            'friday': 4, 'saturday': 5, 'sunday': 6
        }
        
        target_weekday = days_map.get(day_of_week.lower())
        if target_weekday is None:
            return []
        
        dates = []
        for year, data in SCHOOL_TERM_DATES.items():
            for term_name, start_str, end_str in data['terms']['eastern_nsw']:
                start_date = datetime.strptime(start_str, '%Y-%m-%d')
                end_date = datetime.strptime(end_str, '%Y-%m-%d')
                
                # Find first occurrence of target weekday in term
                current = start_date
                while current.weekday() != target_weekday:
                    current += timedelta(days=1)
                    if current > end_date:
                        break
                
                # Add all occurrences of this weekday in the term
                while current <= end_date:
                    if self.today <= current <= self.future_limit:
                        dates.append(current)
                    current += timedelta(days=7)
        
        return sorted(dates)
    
    def parse_time(self, time_str):
        """Parse time string like '10am' or '3.30 - 4.30pm'"""
        time_str = time_str.strip().lower()
        
        # Handle range (take start time)
        if '-' in time_str:
            time_str = time_str.split('-')[0].strip()
        
        # Parse time
        try:
            # Remove spaces
            time_str = time_str.replace(' ', '')
            
            # Handle formats like "10am" or "3.30pm"
            if 'am' in time_str or 'pm' in time_str:
                is_pm = 'pm' in time_str
                time_str = time_str.replace('am', '').replace('pm', '')
                
                if '.' in time_str:
                    hour, minute = time_str.split('.')
                    hour = int(hour)
                    minute = int(minute)
                else:
                    hour = int(time_str)
                    minute = 0
                
                # Convert to 24-hour
                if is_pm and hour != 12:
                    hour += 12
                elif not is_pm and hour == 12:
                    hour = 0
                
                return hour, minute
        except:
            pass
        
        return 0, 0
    
    def scrape_recurring_page(self, url, default_event_name=None):
        """Scrape pages with recurring events (storytime, baby bounce, lego club)"""
        print(f"\nScraping recurring events: {url}")
        response = self.session.get(url)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.content, 'html.parser')
        events = []
        
        # Find main content
        main_content = soup.find('div', class_='node__content')
        if not main_content:
            print("  Could not find main content")
            return events
        
        # First check for H1 with table
        h1_elements = main_content.find_all('h1')
        for h1 in h1_elements:
            event_name = h1.get_text(strip=True)
            
            # Find table after h1 but before next h2
            current = h1.find_next_sibling()
            while current:
                if current.name == 'h2':
                    break
                if current.name == 'table' or (hasattr(current, 'find') and current.find('table')):
                    table = current if current.name == 'table' else current.find('table')
                    table_events = self.parse_table(table, event_name, url)
                    events.extend(table_events)
                    break
                current = current.find_next_sibling()
        
        # Then check for H2 sections with tables
        h2_elements = main_content.find_all('h2')
        for h2 in h2_elements:
            event_name = h2.get_text(strip=True)
            
            # Find table after h2
            current = h2.find_next_sibling()
            while current:
                if current.name in ['h1', 'h2']:
                    break
                if current.name == 'table' or (hasattr(current, 'find') and current.find('table')):
                    table = current if current.name == 'table' else current.find('table')
                    table_events = self.parse_table(table, event_name, url)
                    events.extend(table_events)
                    break
                current = current.find_next_sibling()
        
        # If no H1 or H2 found, look for H3 sections (like Baby Bounce)
        if not events:
            h3_elements = main_content.find_all('h3')
            for h3 in h3_elements:
                section_name = h3.get_text(strip=True)
                
                # Find table after h3
                current = h3.find_next_sibling()
                while current:
                    if current.name in ['h1', 'h2', 'h3']:
                        break
                    if current.name == 'table' or (hasattr(current, 'find') and current.find('table')):
                        table = current if current.name == 'table' else current.find('table')
                        # Use default event name if provided, otherwise use section name
                        name = default_event_name or section_name
                        table_events = self.parse_table(table, name, url)
                        events.extend(table_events)
                        break
                    current = current.find_next_sibling()
        
        # If still no events and we have a default name, search entire content
        if not events and default_event_name:
            tables = main_content.find_all('table')
            for table in tables:
                table_events = self.parse_table(table, default_event_name, url)
                events.extend(table_events)
        
        print(f"  Found {len(events)} recurring events")
        return events
    
    def parse_table(self, table, event_name, event_url):
        """Parse a table with Branch, Day, Time columns"""
        events = []
        
        rows = table.find_all('tr')
        for row in rows[1:]:  # Skip header
            cells = row.find_all('td')
            if len(cells) < 3:
                continue
            
            branch = cells[0].get_text(strip=True)
            day_text = cells[1].get_text(strip=True)
            time_text = cells[2].get_text(strip=True)
            
            # Handle multiple days (e.g., "Thursday & Friday")
            days = []
            if '&' in day_text:
                days = [d.strip() for d in day_text.split('&')]
            else:
                days = [day_text]
            
            for day in days:
                # Get all future dates for this day
                dates = self.get_term_dates_for_day(day)
                
                # Parse time
                hour, minute = self.parse_time(time_text)
                
                # Create event for each date
                for date in dates:
                    event_datetime = date.replace(hour=hour, minute=minute)
                    
                    event = {
                        'title': event_name,
                        'url': event_url,
                        'location': branch,
                        'event_datetime': event_datetime.isoformat(),
                        'event_date_text': event_datetime.strftime('%A, %d %B %Y | %I:%M %p'),
                        'event_type': 'recurring_term_time'
                    }
                    
                    # Add coordinates if branch is known
                    if branch in BRANCH_COORDINATES:
                        event['latitude'] = BRANCH_COORDINATES[branch]['latitude']
                        event['longitude'] = BRANCH_COORDINATES[branch]['longitude']
                    
                    events.append(event)
        
        return events
    
    def scrape_school_holiday_events(self):
        """Scrape school holiday events from API"""
        print(f"\nScraping school holiday events from API...")
        
        try:
            response = self.session.get(self.api_url)
            response.raise_for_status()
            api_events = response.json()
            
            future_events = []
            
            for e in api_events:
                acf = e.get("ACF", {})
                start_date_str = acf.get("start_date")
                
                # Skip if no start_date
                if not start_date_str:
                    continue
                
                # Convert to datetime and skip past events
                try:
                    start_date = datetime.strptime(start_date_str, "%Y-%m-%d %H:%M:%S")
                    if start_date < self.today:
                        continue
                except ValueError:
                    continue
                
                loc = acf.get("location", {})
                location_name = loc.get("address", "")
                
                event = {
                    "title": e["title"]["rendered"],
                    "url": f"https://www.maitlandlibrary.com.au/event/{e.get('slug', '')}",
                    "location": location_name,
                    "latitude": loc.get("lat"),
                    "longitude": loc.get("lng"),
                    "event_datetime": start_date.isoformat(),
                    "event_date_text": start_date.strftime('%A, %d %B %Y | %I:%M %p'),
                    "description": e["content"]["rendered"],
                    "event_type": "school_holiday"
                }
                
                future_events.append(event)
            
            print(f"  Found {len(future_events)} school holiday events")
            return future_events
            
        except Exception as e:
            print(f"  Error scraping API events: {e}")
            return []
    
    def scrape_all(self):
        """Scrape all Maitland Library events"""
        print("=" * 60)
        print("Combined Maitland Library Events Scraper")
        print("=" * 60)
        
        all_events = []
        
        try:
            # 1. Scrape recurring term-time events
            print("\n--- RECURRING TERM-TIME EVENTS ---")
            
            storytime_events = self.scrape_recurring_page(
                f"{self.base_url}/whats-on/storytime"
            )
            all_events.extend(storytime_events)
            
            baby_bounce_events = self.scrape_recurring_page(
                f"{self.base_url}/whats-on/baby-bounce",
                default_event_name="Baby Bounce"
            )
            all_events.extend(baby_bounce_events)
            
            lego_events = self.scrape_recurring_page(
                f"{self.base_url}/whats-on/lego-club",
                default_event_name="Lego Club"
            )
            all_events.extend(lego_events)
            
            # 2. Scrape school holiday events from API
            print("\n--- SCHOOL HOLIDAY EVENTS ---")
            holiday_events = self.scrape_school_holiday_events()
            all_events.extend(holiday_events)
            
        finally:
            # Always close Selenium
            self.close_selenium()
        
        # Sort all events by datetime
        all_events.sort(key=lambda x: x['event_datetime'])
        
        print("\n" + "=" * 60)
        print(f"Total events scraped: {len(all_events)}")
        print(f"  - Recurring term-time: {len([e for e in all_events if e.get('event_type') == 'recurring_term_time'])}")
        print(f"  - School holiday: {len([e for e in all_events if e.get('event_type') == 'school_holiday'])}")
        print("=" * 60)
        
        return all_events
    
    def upload_to_supabase(self, events, supabase_url, supabase_key, table='events_maitland'):
        """Upload events to Supabase"""
        supabase: Client = create_client(supabase_url, supabase_key)
        
        # Map fields to match Supabase schema
        columns = ['title', 'datetime', 'location', 'latitude', 'longitude', 'url','description']
        
        clean = []
        for e in events:
            if 'error' not in e:
                mapped_event = {
                    'title': e.get('title'),
                    'datetime': e.get('event_datetime'),  # Map event_datetime to start_datetime
                    'location': e.get('location'),
                    'latitude': e.get('latitude'),
                    'longitude': e.get('longitude'),
                    'description': e.get('description'),
                    'url': e.get('url')
                }
                clean.append({k: mapped_event.get(k) for k in columns})
        
        # Delete all existing records
        supabase.table(table).delete().neq('title', '').execute()
        
        # Insert new records
        if clean:
            supabase.table(table).insert(clean).execute()
            print(f"✓ Uploaded {len(clean)} records to {table}")
        else:
            print("⚠ No events to upload")


def main():
    scraper = CombinedMaitlandLibraryScraper()
    events = scraper.scrape_all()
    
    # Get Supabase credentials from environment
    supabase_url = os.environ.get('SUPABASE_URL')
    supabase_key = os.environ.get('SUPABASE_KEY')
    
    if supabase_url and supabase_key:
        scraper.upload_to_supabase(events, supabase_url, supabase_key)
    else:
        print("⚠ Supabase credentials missing. Skipping upload.")
    
    print("\n" + "=" * 60)
    print("SCRAPING COMPLETE")
    print("=" * 60)
    print(f"Total events processed: {len(events)}")
    print("=" * 60)


if __name__ == "__main__":
    main()
