from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException
from urllib.parse import urljoin
from datetime import datetime
import time
import re
import os
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
            options.add_argument('--headless=new')
        options.add_argument('--disable-gpu')
        options.add_argument('--no-sandbox')
        options.add_argument("--window-size=1920,1080")
        self.driver = webdriver.Chrome(options=options)

    def contains_filter_word(self, title):
        if not self.filter_words:
            return True
        title_lower = title.lower()
        return any(word in title_lower for word in self.filter_words)

    def get_all_event_links(self):
        print(f"Fetching page: {self.base_url}")
        self.driver.get(self.base_url)

        try:
            WebDriverWait(self.driver, 15).until(
                EC.presence_of_all_elements_located((By.CSS_SELECTOR, "div.grid article"))
            )
        except TimeoutException:
            print("⚠ Timeout waiting for events to load")
            return []

        articles = self.driver.find_elements(By.CSS_SELECTOR, "div.grid article")
        print(f"Found {len(articles)} events on page")
        event_links = []

        for article in articles:
            try:
                link_elem = article.find_element(By.TAG_NAME, 'a')
                title_elem = link_elem.find_element(By.CSS_SELECTOR, 'h2.list-item-title')
                title = title_elem.text.strip()
                event_url = link_elem.get_attribute('href')
                if not event_url.startswith('http'):
                    event_url = urljoin(self.base_url, event_url)

                if self.contains_filter_word(title):
                    event_links.append({'title': title, 'url': event_url})
                    print(f"  ✓ {title}")
            except Exception:
                continue
        return event_links

    def parse_date_from_li(self, li):
        year = li.get_attribute('data-start-year')
        month = li.get_attribute('data-start-month')
        day = li.get_attribute('data-start-day')
        hour = li.get_attribute('data-start-hour')
        mins = li.get_attribute('data-start-mins')
        if not all([year, month, day, hour, mins]):
            return None
        dt = datetime(int(year), int(month), int(day), int(hour), int(mins))
        time_str = f"{hour.zfill(2)}:{mins.zfill(2)}"
        return {'datetime_obj': dt, 'time_str': time_str, 'date_str': dt.strftime("%A, %d %B %Y")}

    def get_event_details(self, event_url, event_title):
        self.driver.get(event_url)
        time.sleep(1.5)  # let JS render
        all_instances = []
        location_items = self.driver.find_elements(By.CSS_SELECTOR, "div.multi-location-item")
        today = datetime.now()

        for loc_item in location_items:
            try:
                location = loc_item.find_element(By.TAG_NAME, 'h3').text
                location = re.split(r',\s*\xa0|,', location)[0].strip()
                date_items = loc_item.find_elements(By.CSS_SELECTOR, 'ul.future-events-list li.multi-date-item')
                for date_li in date_items:
                    parsed = self.parse_date_from_li(date_li)
                    if parsed and parsed['datetime_obj'] >= today:
                        dt_obj = parsed['datetime_obj']
                        start_dt = f"{dt_obj.strftime('%Y-%m-%d')}T{parsed['time_str']}"
                        all_instances.append({
                            'title': event_title,
                            'url': event_url,
                            'location': location,
                            'date': parsed['date_str'],
                            'time': parsed['time_str'],
                            'start_datetime': start_dt
                        })
            except Exception:
                continue
        return all_instances

    def scrape_all(self, delay=1.5):
        links = self.get_all_event_links()
        if not links:
            print("No events found")
            return []

        all_events = []
        for i, ev in enumerate(links, 1):
            print(f"\n[{i}/{len(links)}] {ev['title']}")
            instances = self.get_event_details(ev['url'], ev['title'])
            all_events.extend(instances)
            if i < len(links):
                time.sleep(delay)

        all_events.sort(key=lambda x: x['start_datetime'])
        self.events = all_events
        return all_events

    def add_coordinates(self):
        for e in self.events:
            coords = VENUE_COORDINATES.get(e.get('location'))
            if coords:
                e['latitude'] = coords['latitude']
                e['longitude'] = coords['longitude']
            else:
                e['latitude'] = None
                e['longitude'] = None

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
