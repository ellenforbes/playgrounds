import requests
from bs4 import BeautifulSoup
import json
import time
from datetime import datetime, timedelta
from typing import List, Dict
import re
import os
from supabase import create_client, Client

class NewcastleEventsScraper:
    """Scraper for Newcastle Libraries events calendar"""
    
    def __init__(self, delay=1):
        self.base_url = "https://newcastlelibraries.com.au"
        self.events_url = f"{self.base_url}/experience/what-s-on/what-s-on-events-calendar"
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        self.delay = delay
        
        # Keywords to filter family/kids events
        self.family_keywords = [
            'family', 'toddler', 'babies', 'baby', 'bubs', 'bubba', 'mummabubba',
            'kids', 'teen', 'art starter', 'art play', 'art explorers', 'storytime',
            'rhymetime', 'dungeons', 'lego', 'code', 'stem', 'steam', 'children',
            'school holiday', 'playgroup', 'rock', 'rhyme', 'story stomp'
        ]
    
    def is_family_event(self, title: str) -> bool:
        """Check if event title contains any family/kids keywords"""
        if not title:
            return False
        
        title_lower = title.lower()
        for keyword in self.family_keywords:
            if keyword.lower() in title_lower:
                return True
        return False
    
    def get_event_urls(self) -> List[str]:
        """Get all event URLs from the main calendar page"""
        try:
            response = requests.get(self.events_url, headers=self.headers)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # Find all event links
            event_links = soup.find_all('a', href=True)
            
            # Extract unique URLs that are event pages
            urls = set()
            for link in event_links:
                href = link.get('href', '')
                # Match any link that goes to an event calendar page
                if '/what-s-on-events-calendar/' in href and href != '/experience/what-s-on/what-s-on-events-calendar':
                    if href.startswith('/'):
                        full_url = f"{self.base_url}{href}"
                    else:
                        full_url = href
                    urls.add(full_url)
            
            return sorted(list(urls))
            
        except requests.RequestException as e:
            print(f"Error fetching event URLs: {e}")
            return []
    
    def extract_calendar_dates(self, soup) -> List[Dict]:
        """
        Extract dates from the 'added-event' divs in the calendar
        Each div has: data-date (DD-M-YYYY), data-title (time), data-link (URL)
        """
        dates = []
        
        # Find all 'added-event' divs - these contain the actual event occurrences
        added_events = soup.find_all('div', class_='added-event')
        
        print(f"      [DEBUG] Found {len(added_events)} added-event divs")
        
        for event_div in added_events:
            date_str = event_div.get('data-date')
            time_str = event_div.get('data-title')  # This contains the time
            link_str = event_div.get('data-link')
            
            if date_str:
                # Convert D-M-YYYY or DD-M-YYYY or DD-MM-YYYY to a readable format
                try:
                    # Try different date formats
                    date_obj = None
                    for fmt in ['%d-%m-%Y', '%d-%#m-%Y', '%-d-%m-%Y', '%-d-%#m-%Y']:
                        try:
                            date_obj = datetime.strptime(date_str, fmt)
                            break
                        except (ValueError, AttributeError):
                            continue
                    
                    # If standard parsing fails, manually parse
                    if not date_obj:
                        parts = date_str.split('-')
                        if len(parts) == 3:
                            day, month, year = int(parts[0]), int(parts[1]), int(parts[2])
                            date_obj = datetime(year, month, day)
                    
                    if date_obj:
                        formatted_date = date_obj.strftime('%A %d %B %Y')
                        dates.append({
                            'raw': date_str,
                            'formatted': formatted_date,
                            'datetime': date_obj.isoformat(),
                            'time': time_str or '',
                            'link': link_str or ''
                        })
                    else:
                        # Couldn't parse, store as-is
                        dates.append({
                            'raw': date_str,
                            'formatted': date_str,
                            'datetime': None,
                            'time': time_str or '',
                            'link': link_str or ''
                        })
                except Exception as e:
                    print(f"      [DEBUG] Error parsing date {date_str}: {e}")
                    dates.append({
                        'raw': date_str,
                        'formatted': date_str,
                        'datetime': None,
                        'time': time_str or '',
                        'link': link_str or ''
                    })
        
        return dates
    
    def extract_panel_dates(self, soup) -> List[Dict]:
        """
        Extract dates from the panel div with event-additional-dates list
        Fallback method when calendar divs are not present
        """
        dates = []
        
        # Find the panel with event-additional-dates
        event_dates_ul = soup.find('ul', class_='event-additional-dates')
        
        if not event_dates_ul:
            print(f"      [DEBUG] No event-additional-dates list found")
            return dates
        
        # Find all list items
        list_items = event_dates_ul.find_all('li')
        print(f"      [DEBUG] Found {len(list_items)} list items in panel")
        
        for li in list_items:
            date_span = li.find('span', class_='performances-date')
            time_span = li.find('span', class_='performances-time')
            
            if date_span:
                date_text = date_span.get_text(strip=True)
                time_text = time_span.get_text(strip=True) if time_span else ''
                
                try:
                    # Parse date like "Monday 17 November 2025"
                    date_obj = datetime.strptime(date_text, '%A %d %B %Y')
                    
                    # Create raw format for consistency
                    raw_date = date_obj.strftime('%d-%m-%Y')
                    
                    dates.append({
                        'raw': raw_date,
                        'formatted': date_text,
                        'datetime': date_obj.isoformat(),
                        'time': time_text,
                        'link': ''
                    })
                except Exception as e:
                    print(f"      [DEBUG] Error parsing panel date {date_text}: {e}")
                    dates.append({
                        'raw': date_text,
                        'formatted': date_text,
                        'datetime': None,
                        'time': time_text,
                        'link': ''
                    })
        
        return dates
    
    def scrape_event_details(self, event_url: str) -> Dict:
        """Scrape detailed information from an individual event page"""
        try:
            response = requests.get(event_url, headers=self.headers)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.content, 'html.parser')
            
            event = {
                'url': event_url,
                'title': '',
                'dates': [],  # Will store list of date dictionaries
                'location': '',
            }
            
            # Extract title
            title_tag = soup.find('h1')
            if title_tag:
                event['title'] = title_tag.get_text(strip=True)
            
            # Extract calendar dates FIRST - this is the most reliable method
            calendar_dates = self.extract_calendar_dates(soup)
            if calendar_dates:
                event['dates'] = calendar_dates
                print(f"   → Found {len(calendar_dates)} calendar dates")
            else:
                # Fallback: try to extract from panel div
                panel_dates = self.extract_panel_dates(soup)
                if panel_dates:
                    event['dates'] = panel_dates
                    print(f"   → Found {len(panel_dates)} panel dates")
            
            # Look for location in structured data (dl/dt/dd tags)
            dl_tags = soup.find_all('dl')
            for dl in dl_tags:
                dts = dl.find_all('dt')
                dds = dl.find_all('dd')
                for dt, dd in zip(dts, dds):
                    label = dt.get_text(strip=True).lower()
                    value = dd.get_text(strip=True)
                    
                    if 'location' in label or 'where' in label or 'venue' in label:
                        event['location'] = value
            
            # Try alternative selectors for location
            if not event['location']:
                field_divs = soup.find_all('div', class_=re.compile(r'field|event|info|detail', re.I))
                for div in field_divs:
                    label_tag = div.find(['dt', 'label', 'strong', 'span'], class_=re.compile(r'label|title', re.I))
                    if label_tag:
                        label = label_tag.get_text(strip=True).lower()
                        value_tag = div.find(['dd', 'span', 'div', 'p'])
                        if value_tag and value_tag != label_tag:
                            value = value_tag.get_text(strip=True)
                            
                            if ('location' in label or 'where' in label) and not event['location']:
                                event['location'] = value
            
            # Extract location from title if not found
            if not event['location'] and event['title']:
                location_match = re.search(r'-\s*([^-]+Library)', event['title'])
                if location_match:
                    event['location'] = location_match.group(1).strip()
            
            return event
            
        except requests.RequestException as e:
            print(f"Error fetching event details from {event_url}: {e}")
            return {'url': event_url, 'error': str(e)}
    
    def parse_time_to_datetime(self, date_str: str, time_str: str) -> str:
        """
        Combine date and time into a full datetime string
        date_str: ISO format date like '2025-11-14T00:00:00'
        time_str: Time like '11:00 am - 12:00 pm' or '16:00 pm - 16:45 pm' or '11:00 am'
        Returns: ISO format datetime with actual time like '2025-11-14T11:00:00'
        """
        if not date_str or not time_str:
            return date_str
        
        try:
            # Parse the date part
            date_obj = datetime.fromisoformat(date_str)
            
            # Extract the start time from time_str
            # Handle formats like "11:00 am - 12:00 pm" or "16:00 pm - 16:45 pm" or "11:00 am"
            time_str = time_str.strip()
            
            # Get the first time (before any dash or hyphen)
            start_time_str = time_str.split('-')[0].strip()
            
            # Check if it's 24-hour format (has : and number before : is >= 13)
            # or if it contains digits >= 13
            is_24hour = False
            if ':' in start_time_str:
                hour_part = start_time_str.split(':')[0].strip()
                try:
                    if int(hour_part) >= 13:
                        is_24hour = True
                except ValueError:
                    pass
            
            # If 24-hour format, remove am/pm markers
            if is_24hour:
                start_time_str = start_time_str.replace('am', '').replace('AM', '')
                start_time_str = start_time_str.replace('pm', '').replace('PM', '')
                start_time_str = start_time_str.strip()
            
            # Parse the time
            # Try different time formats
            time_obj = None
            formats_to_try = []
            
            if is_24hour:
                formats_to_try = ['%H:%M', '%H:%M:%S']
            else:
                formats_to_try = ['%I:%M %p', '%I:%M%p', '%H:%M']
            
            for fmt in formats_to_try:
                try:
                    time_obj = datetime.strptime(start_time_str, fmt)
                    break
                except ValueError:
                    continue
            
            if time_obj:
                # Combine date and time
                combined = date_obj.replace(
                    hour=time_obj.hour,
                    minute=time_obj.minute,
                    second=0,
                    microsecond=0
                )
                return combined.isoformat()
            else:
                # Couldn't parse time, return original
                return date_str
                
        except Exception as e:
            print(f"      [DEBUG] Error parsing time '{time_str}': {e}")
            return date_str
    
    def expand_event_dates(self, event: Dict, filter_past=True) -> List[Dict]:
        """
        Takes an event and returns a list of events, one per date occurrence
        If filter_past=True, excludes events with dates in the past
        """
        dates = event.get('dates', [])
        
        if not dates:
            # No calendar dates found, return single event
            return [event]
        
        # Get today's date at midnight for comparison
        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        
        expanded_events = []
        for date_info in dates:
            # Check if date is in the past
            if filter_past and date_info.get('datetime'):
                try:
                    event_date = datetime.fromisoformat(date_info['datetime'])
                    if event_date < today:
                        continue  # Skip past events
                except (ValueError, TypeError):
                    pass  # If we can't parse, include it anyway
            
            event_copy = event.copy()
            
            # Add only the fields we need
            event_copy['date'] = date_info['formatted']
            event_copy['time'] = date_info.get('time', '')
            
            # Combine date and time into start_datetime
            if event_copy['time'] and date_info.get('datetime'):
                event_copy['start_datetime'] = self.parse_time_to_datetime(
                    date_info['datetime'], 
                    event_copy['time']
                )
            else:
                event_copy['start_datetime'] = date_info.get('datetime')
            
            # Remove the dates list from individual entries
            event_copy.pop('dates', None)
            expanded_events.append(event_copy)
        
        return expanded_events
    
    def scrape_all_events(self, max_events=None, expand_dates=True, filter_family=True, filter_past=True) -> List[Dict]:
        """
        Scrape all events with full details
        If expand_dates=True, creates separate entries for each date occurrence
        If filter_family=True, only includes events with family/kids keywords in title
        If filter_past=True, excludes events with dates in the past
        """
        print("Fetching event URLs from calendar page...")
        event_urls = self.get_event_urls()
        
        if max_events:
            event_urls = event_urls[:max_events]
        
        print(f"Found {len(event_urls)} unique event URLs")
        print("Scraping event details...\n")
        
        all_events = []
        filtered_count = 0
        past_count = 0
        
        for i, url in enumerate(event_urls, 1):
            print(f"[{i}/{len(event_urls)}] Scraping: {url.split('/')[-1][:50]}...")
            event = self.scrape_event_details(url)
            
            # Skip events with errors
            if 'error' in event:
                all_events.append(event)
                continue
            
            # Apply family filter if enabled
            if filter_family and not self.is_family_event(event.get('title', '')):
                print(f"   ✗ Filtered out (not a family event)")
                filtered_count += 1
                continue
            
            if expand_dates:
                # Expand into multiple events if it has multiple dates
                # This also filters past dates if filter_past=True
                expanded = self.expand_event_dates(event, filter_past=filter_past)
                
                # Count how many dates were filtered out
                original_count = len(event.get('dates', []))
                if filter_past and original_count > len(expanded):
                    past_filtered = original_count - len(expanded)
                    past_count += past_filtered
                    if past_filtered > 0:
                        print(f"   ✗ Filtered out {past_filtered} past date(s)")
                
                # Only add if there are future dates remaining
                if expanded:
                    all_events.extend(expanded)
                    if len(expanded) > 1:
                        print(f"   → Expanded into {len(expanded)} date occurrences")
                else:
                    print(f"   ✗ All dates in the past")
            else:
                all_events.append(event)
            
            # Be polite - delay between requests
            if i < len(event_urls):
                time.sleep(self.delay)
        
        if filter_family and filtered_count > 0:
            print(f"\n✓ Filtered out {filtered_count} non-family events")
        if filter_past and past_count > 0:
            print(f"✓ Filtered out {past_count} past date(s)")
        
        return all_events
    
    def save_to_json(self, events: List[Dict], filename: str = 'newcastle_events.json'):
        """Save events to a JSON file"""
        # Keep only the columns we need
        columns_to_keep = ['title', 'date', 'start_datetime', 'time', 'location', 'url']
        filtered_events = [
            {k: event.get(k) for k in columns_to_keep}
            for event in events
        ]
        
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(filtered_events, f, indent=2, ensure_ascii=False)
        print(f"\nSaved {len(filtered_events)} event entries to {filename}")
    
    def upload_to_supabase(self, events: List[Dict], supabase_url: str, supabase_key: str, table_name: str = 'events_newcastle'):
        """Upload events to Supabase table"""
        try:
            # Initialize Supabase client
            supabase: Client = create_client(supabase_url, supabase_key)
            
            # Keep only the columns we need
            columns_to_keep = ['title', 'date', 'start_datetime', 'time', 'location', 'url']
            filtered_events = [
                {k: event.get(k) for k in columns_to_keep}
                for event in events
                if 'error' not in event  # Skip error entries
            ]
            
            if not filtered_events:
                print("No events to upload to Supabase")
                return
            
            # Delete existing events in the table (optional - comment out if you want to keep old data)
            print(f"Clearing existing data from {table_name}...")
            supabase.table(table_name).delete().neq('title', '').execute()
            
            # Insert new events
            print(f"Uploading {len(filtered_events)} events to Supabase...")
            
            # Batch insert (Supabase can handle multiple rows)
            response = supabase.table(table_name).insert(filtered_events).execute()
            
            print(f"✓ Successfully uploaded {len(filtered_events)} events to {table_name}")
            
        except Exception as e:
            print(f"Error uploading to Supabase: {e}")
            raise


def main():
    """Main function to scrape events and upload to Supabase"""
    scraper = NewcastleEventsScraper(delay=1)
    
    # Scrape all events
    events = scraper.scrape_all_events(expand_dates=True, filter_family=True, filter_past=True)
    
    # Display summary
    print("\n" + "="*80)
    print(f"SCRAPED {len(events)} UPCOMING FAMILY/KIDS EVENT ENTRIES")
    print("="*80 + "\n")
    
    # Show first 5
    for i, event in enumerate(events[:5], 1):
        print(f"{i}. {event.get('title', 'No title')}")
        print(f"   Date: {event.get('date', 'Not found')}")
        print(f"   Start DateTime: {event.get('start_datetime', 'Not found')}")
        print(f"   Time: {event.get('time', 'Not found')}")
        print(f"   Location: {event.get('location', 'Not found')}")
        print()
    
    if len(events) > 5:
        print(f"... and {len(events) - 5} more event entries\n")
    
    # Save to files (optional - for backup)
    if events:
        scraper.save_to_json(events)
        
        # Print some statistics
        unique_titles = len(set(e.get('title', '') for e in events if 'error' not in e))
        with_dates = len([e for e in events if e.get('start_datetime')])
        print(f"\nStatistics:")
        print(f"- Total event entries: {len(events)}")
        print(f"- Unique events: {unique_titles}")
        print(f"- Events with start datetime: {with_dates}")
        if unique_titles > 0:
            print(f"- Average entries per event: {len(events)/unique_titles:.1f}")
    
    # Upload to Supabase
    supabase_url = os.environ.get('SUPABASE_URL')
    supabase_key = os.environ.get('SUPABASE_KEY')
    
    if supabase_url and supabase_key:
        print("\n" + "="*80)
        print("UPLOADING TO SUPABASE")
        print("="*80 + "\n")
        scraper.upload_to_supabase(events, supabase_url, supabase_key)
    else:
        print("\n⚠ Supabase credentials not found. Skipping upload.")
        print("Set SUPABASE_URL and SUPABASE_KEY environment variables to enable upload.")


if __name__ == "__main__":
    main()
