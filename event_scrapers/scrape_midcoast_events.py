import requests
from bs4 import BeautifulSoup
import time
import json
from urllib.parse import urljoin
import re
from datetime import datetime
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

class LibraryEventsScraper:
    def __init__(self, base_url, filter_words=None):
        self.base_url = base_url
        self.filter_words = [word.lower() for word in filter_words] if filter_words else []
        self.events = []
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        })

    def contains_filter_word(self, title):
        if not self.filter_words:
            return True
        title_lower = title.lower()
        return any(word in title_lower for word in self.filter_words)

    def get_event_links_from_page(self, soup):
        events = []
        grid = soup.find('div', class_='grid', role='listitem')
        if not grid:
            events_container = soup.find('div', class_='list-container-grid')
            if events_container:
                grid = events_container.find('div', class_='grid')
        if not grid:
            print("Warning: Could not find events grid")
            return events
        articles = grid.find_all('article')
        for article in articles:
            link = article.find('a', href=True)
            if not link:
                continue
            title_elem = link.find('h2', class_='list-item-title')
            if not title_elem:
                continue
            title = title_elem.get_text(strip=True)
            event_url = link['href']
            if not event_url.startswith('http'):
                event_url = urljoin(self.base_url, event_url)
            if self.contains_filter_word(title):
                events.append({'title': title, 'url': event_url})
        return events

    def get_all_event_links(self):
        time.sleep(1)
        response = self.session.get(self.base_url, timeout=15)
        if response.status_code == 403:
            print("ERROR: 403 Forbidden")
            return []
        response.raise_for_status()
        soup = BeautifulSoup(response.content, 'html.parser')
        return self.get_event_links_from_page(soup)

    def parse_date_from_li(self, li):
        text = li.get_text(strip=True)
        year = li.get('data-start-year')
        month = li.get('data-start-month')
        day = li.get('data-start-day')
        hour = li.get('data-start-hour')
        mins = li.get('data-start-mins')
        if not all([year, month, day, hour, mins]):
            return None
        try:
            dt = datetime(int(year), int(month), int(day), int(hour), int(mins))
        except:
            return None
        time_str = f"{hour.zfill(2)}:{mins.zfill(2)}"
        date_match = re.search(r'([A-Za-z]+,\s+\d{1,2}\s+[A-Za-z]+\s+\d{4})', text)
        date_str = date_match.group(1) if date_match else f"{day}/{month}/{year}"
        return {'date_str': date_str, 'time_str': time_str, 'datetime_obj': dt}

    def get_event_details(self, event_url, event_title):
        try:
            response = self.session.get(event_url, timeout=15)
            response.raise_for_status()
            soup = BeautifulSoup(response.content, 'html.parser')
            today = datetime.now()
            all_instances = []
            location_items = soup.find_all('div', class_='multi-location-item')
            for loc_item in location_items:
                location_h3 = loc_item.find('h3')
                if not location_h3:
                    continue
                location = re.split(r',\s*\xa0|,', location_h3.get_text(strip=True))[0].strip()
                date_container = loc_item.find('div', class_='multi-date-list-container')
                if not date_container:
                    continue
                future_dates = date_container.find('ul', class_='future-events-list')
                if not future_dates:
                    continue
                date_items = future_dates.find_all('li', class_='multi-date-item')
                for date_li in date_items:
                    parsed = self.parse_date_from_li(date_li)
                    if parsed and parsed['datetime_obj'] >= today:
                        dt_obj = parsed['datetime_obj']
                        start_dt = f"{dt_obj.strftime('%Y-%m-%d')}T{parsed['time_str']}"
                        all_instances.append({
                            'title': event_title,
                            'date': parsed['date_str'],
                            'time': parsed['time_str'],
                            'start_datetime': start_dt,
                            'location': location,
                            'url': event_url,
                            'latitude': VENUE_COORDINATES.get(location, {}).get('latitude'),
                            'longitude': VENUE_COORDINATES.get(location, {}).get('longitude')
                        })
            return all_instances
        except Exception as e:
            print(f"Error fetching {event_url}: {e}")
            return []

    def scrape_all(self, delay=1.5):
        event_links = self.get_all_event_links()
        all_events = []
        for i, event in enumerate(event_links, 1):
            instances = self.get_event_details(event['url'], event['title'])
            all_events.extend(instances)
            if i < len(event_links):
                time.sleep(delay)
        self.events = all_events
        return all_events

    def upload_to_supabase(self, events, supabase_url, supabase_key, table='events_midcoast'):
        supabase: Client = create_client(supabase_url, supabase_key)
        columns = ['title', 'date', 'time', 'start_datetime', 'location', 'url', 'latitude', 'longitude']
        clean = [{k: e.get(k) for k in columns} for e in events if 'error' not in e]
        
        if not clean:
            print("⚠ No events to upload. Skipping Supabase insert.")
            return
        
        supabase.table(table).delete().neq('title', '').execute()
        supabase.table(table).insert(clean).execute()
        print(f"Uploaded {len(clean)} records to {table}")

def main():
    BASE_URL = "https://library.midcoast.nsw.gov.au/Whats-on"
    FILTER_WORDS = [
        'family', 'toddler', 'babies', 'baby', 'bubs', 'bubba', 'mummabubba',
        'kids', 'teen', 'art starter', 'art play', 'art explorers', 'storytime',
        'rhymetime', 'dungeons', 'lego', 'code', 'stem', 'steam', 'children',
        'school holiday', 'playgroup', 'rock', 'rhyme', 'story stomp'
    ]
    scraper = LibraryEventsScraper(BASE_URL, filter_words=FILTER_WORDS)
    events = scraper.scrape_all(delay=1.5)

    supabase_url = os.environ.get('SUPABASE_URL')
    supabase_key = os.environ.get('SUPABASE_KEY')
    if supabase_url and supabase_key:
        scraper.upload_to_supabase(events, supabase_url, supabase_key)
    else:
        print("⚠ Supabase credentials missing. Skipping upload.")

if __name__ == "__main__":
    main()
