from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException
from datetime import datetime
import time
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


class SingletonLibraryScraper:
    def __init__(self, base_url, filter_words=None, headless=True):
        self.base_url = base_url
        self.filter_words = [w.lower() for w in filter_words] if filter_words else []
        self.events = []

        options = Options()
        if headless:
            options.add_argument('--headless=new')
        options.add_argument('--disable-gpu')
        options.add_argument('--no-sandbox')
        options.add_argument('--disable-dev-shm-usage')
        options.add_argument("--window-size=1920,1080")
        self.driver = webdriver.Chrome(options=options)

    def contains_filter_word(self, title):
        if not self.filter_words:
            return True
        title_lower = title.lower()
        return any(word in title_lower for word in self.filter_words)

    def extract_time_from_description(self, description):
        """
        Extract the first time mentioned in the description
        Returns time string in HH:MM format or None
        """
        if not description:
            return None
        
        # Pattern to match various time formats
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

    def scrape_all(self):
        """Scrape all events from the page"""
        print(f"Fetching events from: {self.base_url}")
        self.driver.get(self.base_url)

        try:
            WebDriverWait(self.driver, 10).until(
                EC.presence_of_all_elements_located((By.CLASS_NAME, "list-item-container"))
            )
        except TimeoutException:
            print("⚠ Timeout waiting for events to load")
            return []

        time.sleep(2)  # Let page fully render
        
        # Get all events
        event_items = self.driver.find_elements(By.CLASS_NAME, 'list-item-container')
        print(f"Found {len(event_items)} total events")
        
        all_events = []
        
        for item in event_items:
            try:
                # Extract title
                title_elem = item.find_element(By.CLASS_NAME, 'list-item-title')
                title = title_elem.text.strip()
                
                # Check if title contains any keyword
                if not self.contains_filter_word(title):
                    continue
                
                # Extract description
                description = ''
                try:
                    desc_elem = item.find_element(By.CLASS_NAME, 'list-item-block-desc')
                    description = desc_elem.text.strip()
                except:
                    pass
                
                # Extract date
                datetime_str = ''
                try:
                    date_elem = item.find_element(By.CLASS_NAME, 'list-item-block-date')
                    
                    day = date_elem.find_element(By.CLASS_NAME, 'part-date').text.strip()
                    month = date_elem.find_element(By.CLASS_NAME, 'part-month').text.strip()
                    year = date_elem.find_element(By.CLASS_NAME, 'part-year').text.strip()
                    
                    if day and month and year:
                        date_str = f"{day} {month} {year}"
                        try:
                            # Parse date to datetime object
                            event_date = datetime.strptime(date_str, '%d %b %Y')
                            
                            # Try to extract time from description
                            time_str = self.extract_time_from_description(description)
                            if time_str:
                                # Combine date and time
                                datetime_str = f"{event_date.strftime('%Y-%m-%d')} {time_str}"
                            else:
                                # Just date, default to 10:00
                                datetime_str = f"{event_date.strftime('%Y-%m-%d')} 10:00"
                        except Exception as e:
                            print(f"  ⚠ Error parsing date '{date_str}': {e}")
                            continue
                except Exception as e:
                    print(f"  ⚠ Error extracting date: {e}")
                    continue
                
                if not datetime_str:
                    continue
                
                # Extract event URL
                event_url = ''
                try:
                    link_elem = item.find_element(By.TAG_NAME, 'a')
                    event_url = link_elem.get_attribute('href')
                except:
                    pass
                
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
                
                all_events.append(event)
                print(f"  ✓ {title}")
                
            except Exception as e:
                print(f"  ⚠ Error parsing event: {e}")
                continue
        
        all_events.sort(key=lambda x: x['datetime'])
        self.events = all_events
        return all_events

    def upload_to_supabase(self, supabase_url, supabase_key, table='events_singleton'):
        """Upload events to Supabase"""
        if not self.events:
            print("No events to upload.")
            return

        supabase: Client = create_client(supabase_url, supabase_key)
        columns = ['title', 'description', 'datetime', 'location', 'url', 'latitude', 'longitude']
        clean = [{k: e.get(k) for k in columns} for e in self.events if 'error' not in e]

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
    BASE_URL = "https://www.singleton.nsw.gov.au/Live/Residents/Library/Whats-on-at-the-Library"
    scraper = SingletonLibraryScraper(BASE_URL, filter_words=FAMILY_KEYWORDS)
    scraper.scrape_all()

    supabase_url = os.environ.get('SUPABASE_URL')
    supabase_key = os.environ.get('SUPABASE_KEY')
    if supabase_url and supabase_key:
        scraper.upload_to_supabase(supabase_url, supabase_key)
    else:
        print("⚠ Supabase credentials missing. Skipping upload.")

    scraper.driver.quit()


if __name__ == "__main__":
    main()
