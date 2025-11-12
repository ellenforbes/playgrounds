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

# Venue coordinates
VENUE_COORDINATES = {
    'Murrurundi Library': {'latitude': -31.7667, 'longitude': 150.8333},
    'Scone Library': {'latitude': -32.0500, 'longitude': 150.8667},
    'Merriwa Library': {'latitude': -32.1500, 'longitude': 150.4167},
    'Aberdeen Library': {'latitude': -32.1667, 'longitude': 150.8833}
}

FAMILY_KEYWORDS = [
    'family', 'toddler', 'babies', 'baby', 'bubs', 'bubba', 'mummabubba',
    'kids', 'teen', 'art starter', 'art play', 'art explorers', 'storytime',
    'rhymetime', 'dungeons', 'lego', 'code', 'stem', 'steam', 'children',
    'school holiday', 'playgroup', 'rock', 'rhyme', 'story stomp', 'little ones',
    'story time', 'craft'
]

class UpperHunterLibraryScraper:
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

    def get_all_event_links(self):
        """Collect all event links from all pages"""
        print(f"Fetching events from: {self.base_url}")
        self.driver.get(self.base_url)

        try:
            WebDriverWait(self.driver, 10).until(
                EC.presence_of_all_elements_located((By.CLASS_NAME, "list-item-container"))
            )
        except TimeoutException:
            print("⚠ Timeout waiting for events to load")
            return []

        event_links = []
        page_num = 1

        while True:
            print(f"Processing page {page_num}...")
            
            # Get all events on current page
            event_items = self.driver.find_elements(By.CLASS_NAME, 'list-item-container')
            
            for item in event_items:
                try:
                    article = item.find_element(By.TAG_NAME, 'article')
                    link = article.find_element(By.TAG_NAME, 'a')
                    title_elem = link.find_element(By.CLASS_NAME, 'list-item-title')
                    
                    title = title_elem.text.strip()
                    event_url = link.get_attribute('href')
                    
                    if self.contains_filter_word(title):
                        # Get description and location from list page
                        description = ''
                        location_text = ''
                        
                        try:
                            desc_elem = link.find_element(By.CLASS_NAME, 'list-item-block-desc')
                            description = desc_elem.text.strip()
                        except:
                            pass
                        
                        try:
                            location_elem = item.find_element(By.CLASS_NAME, 'list-item-address')
                            location_text = location_elem.text.strip()
                        except:
                            pass
                        
                        event_links.append({
                            'title': title,
                            'url': event_url,
                            'description': description,
                            'location_text': location_text
                        })
                        print(f"  ✓ {title}")
                except Exception as e:
                    continue
            
            # Check for next page
            try:
                disabled_next = self.driver.find_elements(By.CSS_SELECTOR, 'li.disabled span.next')
                if disabled_next:
                    print(f"Reached last page at page {page_num}")
                    break
                
                next_link = self.driver.find_element(By.CSS_SELECTOR, 'a.page-link.next')
                next_link.click()
                time.sleep(1)
                WebDriverWait(self.driver, 10).until(
                    EC.presence_of_all_elements_located((By.CLASS_NAME, "list-item-container"))
                )
                page_num += 1
            except Exception:
                print(f"Reached last page at page {page_num}")
                break

        print(f"Found {len(event_links)} matching events")
        return event_links

    def parse_location(self, location_text):
        """Parse location text and return location name"""
        if not location_text:
            return 'Scone Library'
        
        # Check which location is mentioned
        location_lower = location_text.lower()
        for venue_name in VENUE_COORDINATES.keys():
            if venue_name.lower().replace(' library', '') in location_lower:
                return venue_name
        
        # Extract name from format: "Murrurundi Library, 47 Mayne Street, Murrurundi 2338"
        parts = location_text.split(',')
        if parts:
            return parts[0].strip()
        
        return 'Scone Library'

    def get_event_details(self, event_data):
        """Visit event page and extract datetime"""
        try:
            self.driver.get(event_data['url'])
            
            # Wait for the date element
            wait = WebDriverWait(self.driver, 10)
            date_elem = wait.until(
                EC.presence_of_element_located((By.CLASS_NAME, 'event-date'))
            )
            
            date_text = date_elem.text.strip()
            
            # Parse format: "Next date: Friday, 14 November 2025 | 10:00 AM to 11:00 AM"
            match = re.search(r'(\d{1,2}\s+\w+\s+\d{4})\s*\|\s*(\d{1,2}:\d{2}\s*(?:AM|PM))', date_text)
            
            if match:
                date_part = match.group(1)
                time_part = match.group(2)
                
                try:
                    datetime_str = f"{date_part} {time_part}"
                    dt_obj = datetime.strptime(datetime_str, '%d %B %Y %I:%M %p')
                    
                    location = self.parse_location(event_data['location_text'])
                    
                    return {
                        'title': event_data['title'],
                        'description': event_data['description'],
                        'date': dt_obj.strftime('%A, %d %B %Y'),
                        'time': dt_obj.strftime('%I:%M %p'),
                        'start_datetime': dt_obj.strftime('%Y-%m-%dT%H:%M'),
                        'location': location,
                        'url': event_data['url']
                    }
                except Exception as e:
                    print(f"  ⚠ Error parsing datetime: {e}")
                    return None
            
            return None
            
        except Exception as e:
            print(f"  ⚠ Error extracting details: {e}")
            return None

    def scrape_all(self, delay=1):
        """Scrape all events"""
        links = self.get_all_event_links()
        if not links:
            print("No events found")
            return []

        all_events = []
        for i, event_data in enumerate(links, 1):
            print(f"\n[{i}/{len(links)}] {event_data['title']}")
            event_details = self.get_event_details(event_data)
            if event_details:
                all_events.append(event_details)
            if i < len(links):
                time.sleep(delay)

        all_events.sort(key=lambda x: x['start_datetime'])
        self.events = all_events
        return all_events

    def add_coordinates(self):
        """Add coordinates to events based on location"""
        for e in self.events:
            coords = VENUE_COORDINATES.get(e.get('location'))
            if coords:
                e['latitude'] = coords['latitude']
                e['longitude'] = coords['longitude']
            else:
                e['latitude'] = None
                e['longitude'] = None

    def upload_to_supabase(self, supabase_url, supabase_key, table='events_upperhunter'):
        """Upload events to Supabase"""
        if not self.events:
            print("No events to upload.")
            return

        supabase: Client = create_client(supabase_url, supabase_key)
        columns = ['title', 'description', 'date', 'time', 'start_datetime', 'location', 'url', 'latitude', 'longitude']
        clean = [{k: e.get(k) for k in columns} for e in self.events if 'error' not in e]

        supabase.table(table).delete().neq('title', '').execute()
        supabase.table(table).insert(clean).execute()
        print(f"Uploaded {len(clean)} records to {table}")


def main():
    BASE_URL = "https://www.upperhunter.nsw.gov.au/Events-Activities"
    scraper = UpperHunterLibraryScraper(BASE_URL, filter_words=FAMILY_KEYWORDS)
    scraper.scrape_all()
    scraper.add_coordinates()

    supabase_url = os.environ.get('SUPABASE_URL')
    supabase_key = os.environ.get('SUPABASE_KEY')
    if supabase_url and supabase_key:
        scraper.upload_to_supabase(supabase_url, supabase_key)
    else:
        print("⚠ Supabase credentials missing. Skipping upload.")

    scraper.driver.quit()


if __name__ == "__main__":
    main()
