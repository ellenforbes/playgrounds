import os
import re
import time
from datetime import datetime
from urllib.parse import urljoin

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service as ChromeService
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

from supabase import create_client, Client

# Venue coordinates
VENUE_COORDINATES = {
    'Tea Gardens Library': {'latitude': -32.6698078, 'longitude': 152.1643706},
    'Hallidays Point Library': {'latitude': -32.0684999, 'longitude': 152.5354383},
    'Wingham Library': {'latitude': -31.8700834, 'longitude': 152.3733694},
    'Forster Library': {'latitude': -32.1827565, 'longitude': 152.5123024},
    'Taree Library': {'latitude': -31.9146128, 'longitude': 152.4568841},
    'Harrington Library': {'latitude': -31.881619, 'longitude': 152.6611122},
    'Stroud Library': {'latitude': -32.4044259, 'longitude': 151.9642841},
    'Gloucester Library': {'latitude': -32.0073153, 'longitude': 151.9562654},
}

FAMILY_KEYWORDS = [
    'family', 'toddler', 'babies', 'baby', 'bubs', 'bubba', 'mummabubba',
    'kids', 'teen', 'art starter', 'art play', 'art explorers', 'storytime',
    'rhymetime', 'dungeons', 'lego', 'code', 'stem', 'steam', 'children',
    'school holiday', 'playgroup', 'rock', 'rhyme', 'story stomp'
]

class SeleniumLibraryScraper:
    def __init__(self, base_url, filter_words=None, headless=True):
        self.base_url = base_url
        self.filter_words = [w.lower() for w in filter_words] if filter_words else []
        self.events = []

        options = Options()
        if headless:
            options.add_argument("--headless=new")
        options.add_argument("--disable-gpu")
        options.add_argument("--no-sandbox")
        options.add_argument("--window-size=1920,1080")
        options.add_argument("--disable-dev-shm-usage")

        self.driver = webdriver.Chrome(options=options)

    def contains_filter_word(self, title):
        if not self.filter_words:
            return True
        title_lower = title.lower()
        return any(word in title_lower for word in self.filter_words)

    def get_event_links(self):
        self.driver.get(self.base_url)
        wait = WebDriverWait(self.driver, 10)

        try:
            # Wait for grid to load
            grid = wait.until(EC.presence_of_element_located((By.CLASS_NAME, 'grid')))
        except:
            print("Could not find event grid.")
            return []

        links = grid.find_elements(By.TAG_NAME, 'a')
        events = []
        for link in links:
            try:
                title_elem = link.find_element(By.CLASS_NAME, 'list-item-title')
                title = title_elem.text.strip()
                if self.contains_filter_word(title):
                    event_url = link.get_attribute('href')
                    events.append({'title': title, 'url': event_url})
            except:
                continue
        return events

    def parse_date_li(self, li):
        year = li.get_attribute('data-start-year')
        month = li.get_attribute('data-start-month')
        day = li.get_attribute('data-start-day')
        hour = li.get_attribute('data-start-hour')
        mins = li.get_attribute('data-start-mins')

        if not all([year, month, day, hour, mins]):
            return None

        try:
            dt = datetime(int(year), int(month), int(day), int(hour), int(mins))
        except:
            return None

        time_str = f"{hour.zfill(2)}:{mins.zfill(2)}"
        text = li.text
        date_match = re.search(r'([A-Za-z]+,\s+\d{1,2}\s+[A-Za-z]+\s+\d{4})', text)
        date_str = date_match.group(1) if date_match else f"{day}/{month}/{year}"

        return {'date_str': date_str, 'time_str': time_str, 'datetime_obj': dt}

    def get_event_details(self, event):
        self.driver.get(event['url'])
        time.sleep(1)

        today = datetime.now()
        all_instances = []

        try:
            locations = self.driver.find_elements(By.CLASS_NAME, 'multi-location-item')
        except:
            return []

        for loc in locations:
            try:
                location_elem = loc.find_element(By.TAG_NAME, 'h3')
                location = re.split(r',\s*\xa0|,', location_elem.text.strip())[0]
            except:
                continue

            try:
                date_ul = loc.find_element(By.CLASS_NAME, 'future-events-list')
                date_lis = date_ul.find_elements(By.CLASS_NAME, 'multi-date-item')
            except:
                continue

            for li in date_lis:
                parsed = self.parse_date_li(li)
                if parsed and parsed['datetime_obj'] >= today:
                    dt_obj = parsed['datetime_obj']
                    start_dt = f"{dt_obj.strftime('%Y-%m-%d')}T{parsed['time_str']}"
                    all_instances.append({
                        'title': event['title'],
                        'date': parsed['date_str'],
                        'time': parsed['time_str'],
                        'start_datetime': start_dt,
                        'location': location,
                        'url': event['url'],
                        'latitude': VENUE_COORDINATES.get(location, {}).get('latitude'),
                        'longitude': VENUE_COORDINATES.get(location, {}).get('longitude')
                    })

        return all_instances

    def scrape_all(self):
        event_links = self.get_event_links()
        all_events = []

        for i, e in enumerate(event_links, 1):
            instances = self.get_event_details(e)
            all_events.extend(instances)
            time.sleep(1)

        self.events = all_events
        return all_events

    def upload_to_supabase(self, supabase_url, supabase_key, table='events_midcoast'):
        if not self.events:
            print("No events to upload.")
            return

        supabase: Client = create_client(supabase_url, supabase_key)
        columns = ['title', 'date', 'time', 'start_datetime', 'location', 'url', 'latitude', 'longitude']
        clean = [{k: e.get(k) for k in columns} for e in self.events if 'error' not in e]

        supabase.table(table).delete().neq('title', '').execute()
        supabase.table(table).insert(clean).execute()
        print(f"Uploaded {len(clean)} records to {table}")


def main():
    BASE_URL = "https://library.midcoast.nsw.gov.au/Whats-on"
    scraper = SeleniumLibraryScraper(BASE_URL, filter_words=FAMILY_KEYWORDS)
    events = scraper.scrape_all()

    supabase_url = os.environ.get('SUPABASE_URL')
    supabase_key = os.environ.get('SUPABASE_KEY')
    if supabase_url and supabase_key:
        scraper.upload_to_supabase(supabase_url, supabase_key)
    else:
        print("⚠ Supabase credentials missing. Skipping upload.")

    scraper.driver.quit()


if __name__ == "__main__":
    main()
