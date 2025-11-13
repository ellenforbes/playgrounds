import requests
from bs4 import BeautifulSoup
import re
import os
from datetime import datetime
from supabase import create_client, Client

class DungogEventsScraper:
    def __init__(self):
        self.base_url = "https://www.dungog.nsw.gov.au"
        self.home_url = f"{self.base_url}/Home"
        self.keywords = [
            'family', 'toddler', 'babies', 'baby', 'bubs', 'bubba', 
            'mummabubba', 'kids', 'teen', 'art starter', 'art play', 
            'art explorers', 'storytime', 'rhymetime', 'dungeons', 
            'lego', 'code', 'stem', 'steam', 'children', 'school holiday', 
            'playgroup', 'rock', 'rhyme', 'story stomp', 'little ones', 'story time'
        ]
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        
    def contains_keyword(self, text):
        """Check if text contains any of the keywords"""
        text_lower = text.lower()
        for keyword in self.keywords:
            if keyword in text_lower:
                return True
        return False
    
    def scrape_events_list(self):
        """Scrape the events list from the homepage"""
        print(f"Fetching homepage: {self.home_url}")
        response = self.session.get(self.home_url)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Find the events panel
        events_panel = soup.find('div', id='panel-2')
        if not events_panel:
            print("Could not find events panel")
            return []
        
        # Find all event items
        event_items = events_panel.find_all('div', class_='col-xs-12')
        print(f"Found {len(event_items)} total events")
        
        relevant_events = []
        
        for item in event_items:
            link = item.find('a')
            if not link:
                continue
            
            title = link.find('h2').text.strip() if link.find('h2') else ''
            description = link.find('p', class_=lambda x: x != 'event-date')
            description_text = description.text.strip() if description else ''
            url = link.get('href', '')
            event_date = link.find('p', class_='event-date')
            event_date_text = event_date.text.strip() if event_date else ''
            
            # Check if event contains relevant keywords
            combined_text = f"{title} {description_text}".lower()
            if self.contains_keyword(combined_text):
                # Make URL absolute
                if url and not url.startswith('http'):
                    url = self.base_url + url
                
                relevant_events.append({
                    'title': title,
                    'description': description_text,
                    'list_date': event_date_text,
                    'url': url
                })
                print(f"✓ Found relevant event: {title}")
        
        return relevant_events
    
    def scrape_event_details(self, event_url):
        """Scrape detailed information from an event page"""
        print(f"  Fetching details from: {event_url}")
        
        try:
            response = self.session.get(event_url)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.content, 'html.parser')
            
            details = {}
            
            # Get event dates - check for multi-date list first
            all_dates = []
            
            # Look for multi-date container with future events
            multi_date_container = soup.find('div', class_='multi-date-list-container')
            if multi_date_container:
                # Find only future events (not past events)
                future_events_list = multi_date_container.find('ul', class_='future-events-list')
                if future_events_list:
                    date_items = future_events_list.find_all('li', class_='multi-date-item')
                    print(f"  Found {len(date_items)} future dates in multi-date list")
                    
                    for item in date_items:
                        # Get data attributes
                        year = item.get('data-start-year')
                        month = item.get('data-start-month')
                        day = item.get('data-start-day')
                        hour = item.get('data-start-hour')
                        mins = item.get('data-start-mins')
                        
                        if year and month and day:
                            try:
                                # Create datetime from data attributes
                                datetime_obj = datetime(
                                    int(year), 
                                    int(month), 
                                    int(day),
                                    int(hour) if hour else 0,
                                    int(mins) if mins else 0
                                )
                                
                                # Get the text content
                                date_text = item.get_text(strip=True)
                                
                                all_dates.append({
                                    'text': date_text,
                                    'datetime': datetime_obj
                                })
                            except (ValueError, TypeError) as e:
                                print(f"  Warning: Could not parse date from attributes: {e}")
            
            # If no multi-date list found, check for single "Next date:" format
            if not all_dates:
                event_date_elem = soup.find('p', class_='event-date')
                if event_date_elem:
                    event_date_text = event_date_elem.get_text(strip=True)
                    datetime_obj = self.parse_datetime(event_date_text)
                    if datetime_obj:
                        all_dates.append({
                            'text': event_date_text,
                            'datetime': datetime_obj
                        })
            
            details['all_dates'] = all_dates
            
            # Get location
            location_heading = soup.find('h2', string=re.compile(r'Location', re.I))
            if location_heading:
                location_p = location_heading.find_next('p')
                if location_p:
                    # Remove the "View Map" link text
                    for a in location_p.find_all('a'):
                        a.decompose()
                    location_text = location_p.get_text(strip=True)
                    details['location'] = location_text
                    
                    # Add coordinates for Dungog Library locations
                    if location_text.startswith('Dungog Shire Library') or location_text.startswith('Dungog Library'):
                        details['latitude'] = -32.4034728
                        details['longitude'] = 151.7561613
            
            # Get full description
            content_div = soup.find('div', class_='content-area')
            if content_div:
                # Get all paragraphs that are not event-date or location
                paragraphs = []
                for p in content_div.find_all('p'):
                    if 'event-date' not in p.get('class', []):
                        text = p.get_text(strip=True)
                        if text and 'View Map' not in text:
                            paragraphs.append(text)
                
                if paragraphs:
                    details['full_description'] = '\n'.join(paragraphs[:3])  # First 3 paragraphs
            
            # Look for recurring dates or multiple dates
            all_text = soup.get_text()
            if 'every' in all_text.lower() or 'weekly' in all_text.lower():
                details['recurring'] = True
            
            return details
            
        except Exception as e:
            print(f"  Error scraping {event_url}: {e}")
            return {}
    
    def parse_datetime(self, date_text):
        """Parse datetime from various date formats"""
        # Remove "Next date:" prefix if present
        date_text = re.sub(r'^Next date:\s*', '', date_text, flags=re.IGNORECASE)
        
        # Common patterns to try
        patterns = [
            # Wednesday, 19 November 2025 | 10:30 AM to 11:30 AM
            (r'(\w+),\s+(\d{1,2})\s+(\w+)\s+(\d{4})\s*\|\s*(\d{1,2}):(\d{2})\s*(AM|PM)', 
             '%A, %d %B %Y | %I:%M %p'),
            # 19 November 2025
            (r'(\d{1,2})\s+(\w+)\s+(\d{4})', '%d %B %Y'),
        ]
        
        for pattern, fmt in patterns:
            match = re.search(pattern, date_text)
            if match:
                try:
                    # Extract the matched portion
                    matched_text = match.group(0)
                    # Parse the datetime
                    dt = datetime.strptime(matched_text, fmt)
                    return dt
                except ValueError:
                    continue
        
        return None
    
    def scrape_all(self):
        """Main scraping function"""
        print("=" * 60)
        print("Dungog Events Scraper - Family & Kids Events")
        print("=" * 60)
        
        # Get events list
        events = self.scrape_events_list()
        print(f"\nFound {len(events)} relevant events")
        print("=" * 60)
        
        # Get details for each event and expand multi-date events
        expanded_events = []
        
        for i, event in enumerate(events, 1):
            print(f"\n[{i}/{len(events)}] {event['title']}")
            details = self.scrape_event_details(event['url'])
            
            # Check if there are multiple dates
            all_dates = details.get('all_dates', [])
            
            if len(all_dates) > 1:
                # Create separate event for each date
                print(f"  → Creating {len(all_dates)} separate events for multiple dates")
                for date_info in all_dates:
                    event_copy = event.copy()
                    event_copy.update(details)
                    event_copy['event_date_text'] = date_info['text']
                    event_copy['event_datetime'] = date_info['datetime'].isoformat()
                    # Remove the all_dates field from individual events
                    event_copy.pop('all_dates', None)
                    expanded_events.append(event_copy)
            elif len(all_dates) == 1:
                # Single date - just add it normally
                event.update(details)
                event['event_date_text'] = all_dates[0]['text']
                event['event_datetime'] = all_dates[0]['datetime'].isoformat()
                event.pop('all_dates', None)
                expanded_events.append(event)
            else:
                # No dates parsed - add the event as is
                event.update(details)
                event.pop('all_dates', None)
                expanded_events.append(event)
        
        return expanded_events
    
    def upload_to_supabase(self, events, supabase_url, supabase_key, table='events_dungog'):
        """Upload events to Supabase"""
        supabase: Client = create_client(supabase_url, supabase_key)
        
        # Map fields to match Supabase schema
        columns = ['title', 'date', 'start_datetime', 'time', 'location', 'latitude', 'longitude', 'url']
        
        clean = []
        for e in events:
            if 'error' not in e:
                mapped_event = {
                    'title': e.get('title'),
                    'date': e.get('event_date_text'),  # Map event_date_text to date
                    'start_datetime': e.get('event_datetime'),  # Map event_datetime to start_datetime
                    'time': e.get('event_date_text'),  # Use event_date_text for time field too
                    'location': e.get('location'),
                    'latitude': e.get('latitude'),
                    'longitude': e.get('longitude'),
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
    scraper = DungogEventsScraper()
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
