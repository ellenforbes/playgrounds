import requests
from bs4 import BeautifulSoup
import json
import time
from datetime import datetime
from typing import List, Dict
import re
import os
from supabase import create_client, Client

# Venue mapping with coordinates
VENUE_COORDINATES = {
    'Newcastle City Library': {
        'latitude': -32.9293162,
        'longitude': 151.7724648
    },
    'Wallsend Library': {
        'latitude': -32.9020955,
        'longitude': 151.665831
    },
}

class NewcastleEventsScraper:
    def __init__(self, delay=1):
        self.base_url = "https://newcastlelibraries.com.au"
        self.events_url = f"{self.base_url}/experience/what-s-on/what-s-on-events-calendar"
        self.headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        self.delay = delay
        
        self.family_keywords = [
            'family', 'toddler', 'babies', 'baby', 'bubs', 'bubba', 'mummabubba',
            'kids', 'teen', 'art starter', 'art play', 'art explorers', 'storytime',
            'rhymetime', 'dungeons', 'lego', 'code', 'stem', 'steam', 'children',
            'school holiday', 'playgroup', 'rock', 'rhyme', 'story stomp'
        ]
    
    def is_family_event(self, title: str) -> bool:
        return any(keyword in title.lower() for keyword in self.family_keywords)
    
    def get_event_urls(self) -> List[str]:
        try:
            response = requests.get(self.events_url, headers=self.headers)
            response.raise_for_status()
            soup = BeautifulSoup(response.content, 'html.parser')
            event_links = soup.find_all('a', href=True)
            
            urls = set()
            for link in event_links:
                href = link.get('href', '')
                if '/what-s-on-events-calendar/' in href and href != '/experience/what-s-on/what-s-on-events-calendar':
                    urls.add(f"{self.base_url}{href}" if href.startswith('/') else href)
            return sorted(list(urls))
        except:
            return []
    
    def extract_calendar_dates(self, soup):
        dates = []
        for event_div in soup.find_all('div', class_='added-event'):
            date_str = event_div.get('data-date')
            time_str = event_div.get('data-title')
            link_str = event_div.get('data-link')
            
            if not date_str:
                continue
            
            try:
                day, month, year = map(int, date_str.split('-'))
                date_obj = datetime(year, month, day)
                dates.append({
                    'raw': date_str,
                    'formatted': date_obj.strftime('%A %d %B %Y'),
                    'datetime': date_obj.isoformat(),
                    'time': time_str or '',
                    'link': link_str or ''
                })
            except:
                pass
        
        return dates
    
    def extract_panel_dates(self, soup):
        dates = []
        event_dates_ul = soup.find('ul', class_='event-additional-dates')
        if not event_dates_ul:
            return dates
        
        for li in event_dates_ul.find_all('li'):
            date_span = li.find('span', class_='performances-date')
            time_span = li.find('span', class_='performances-time')
            if not date_span:
                continue
            
            date_text = date_span.get_text(strip=True)
            time_text = time_span.get_text(strip=True) if time_span else ''
            
            try:
                date_obj = datetime.strptime(date_text, '%A %d %B %Y')
                raw = date_obj.strftime('%d-%m-%Y')
                dates.append({
                    'raw': raw,
                    'formatted': date_text,
                    'datetime': date_obj.isoformat(),
                    'time': time_text,
                    'link': ''
                })
            except:
                pass
        
        return dates
    
    def scrape_event_details(self, event_url: str) -> Dict:
        try:
            response = requests.get(event_url, headers=self.headers)
            soup = BeautifulSoup(response.content, 'html.parser')
            
            event = {'url': event_url, 'title': '', 'dates': [], 'location': ''}
            title_tag = soup.find('h1')
            if title_tag: event['title'] = title_tag.get_text(strip=True)
            
            dates = self.extract_calendar_dates(soup) or self.extract_panel_dates(soup)
            event['dates'] = dates
            
            # Try to detect location
            dl_tags = soup.find_all('dl')
            for dl in dl_tags:
                for dt, dd in zip(dl.find_all('dt'), dl.find_all('dd')):
                    if 'location' in dt.get_text(strip=True).lower():
                        event['location'] = dd.get_text(strip=True)
            
            return event
        except:
            return {'url': event_url, 'error': 'Failed to load'}
    
    def parse_time_to_datetime(self, date_str, time_str):
        if not date_str or not time_str:
            return date_str
        
        try:
            date_obj = datetime.fromisoformat(date_str)
            start_time = time_str.split('-')[0].strip()
            for fmt in ['%I:%M %p', '%H:%M', '%I:%M%p']:
                try:
                    t = datetime.strptime(start_time, fmt)
                    return date_obj.replace(hour=t.hour, minute=t.minute).isoformat()
                except:
                    pass
            return date_str
        except:
            return date_str
    
    def expand_event_dates(self, event, filter_past=True):
        today = datetime.now().replace(hour=0, minute=0)
        expanded = []
        
        # Normalise location *once* (but never remove original meaning)
        location = (event.get('location') or '').strip()
    
        for d in event.get('dates', []):
            if filter_past and d.get('datetime'):
                if datetime.fromisoformat(d['datetime']) < today:
                    continue
            
            e = event.copy()
            e['location'] = location  # ✅ Ensure location stays correct text
            
            e['date'] = d['formatted']
            e['time'] = d.get('time', '')
            e['start_datetime'] = self.parse_time_to_datetime(d.get('datetime'), e['time'])
            e.pop('dates', None)
            
            # ✅ Apply coordinates without altering location
            coords = VENUE_COORDINATES.get(location)
            if coords:
                e['latitude'] = coords['latitude']
                e['longitude'] = coords['longitude']
            
            expanded.append(e)
        
        return expanded or [event]
    
    def scrape_all_events(self, expand_dates=True, filter_family=True, filter_past=True):
        urls = self.get_event_urls()
        all_events = []
        
        for url in urls:
            event = self.scrape_event_details(url)
            if 'error' in event:
                continue
            
            if filter_family and not self.is_family_event(event['title']):
                continue
            
            if expand_dates:
                all_events.extend(self.expand_event_dates(event, filter_past))
            else:
                all_events.append(event)
            
            time.sleep(self.delay)
        
        return all_events
    
    def save_to_json(self, events, filename='newcastle_events.json'):
        columns = ['title','date','start_datetime','time','location','latitude','longitude','url']
        clean = [{k: e.get(k) for k in columns} for e in events]
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(clean, f, indent=2, ensure_ascii=False)
        print(f"Saved {len(clean)} events → {filename}")
    
    def upload_to_supabase(self, events, supabase_url, supabase_key, table='events_newcastle'):
        supabase: Client = create_client(supabase_url, supabase_key)
        columns = ['title','date','start_datetime','time','location','latitude','longitude','url']
        clean = [{k: e.get(k) for k in columns} for e in events if 'error' not in e]
        
        supabase.table(table).delete().neq('title','').execute()
        supabase.table(table).insert(clean).execute()
        print(f"Uploaded {len(clean)} records to {table}")

def main():
    scraper = NewcastleEventsScraper(delay=1)
    events = scraper.scrape_all_events()
    
    scraper.save_to_json(events)
    
    supabase_url = os.environ.get('SUPABASE_URL')
    supabase_key = os.environ.get('SUPABASE_KEY')
    if supabase_url and supabase_key:
        scraper.upload_to_supabase(events, supabase_url, supabase_key)
    else:
        print("⚠ Supabase credentials missing. Skipping upload.")

if __name__ == "__main__":
    main()
