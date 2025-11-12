from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from bs4 import BeautifulSoup
from supabase import create_client, Client
import json
import time
from datetime import datetime, timedelta
from urllib.parse import urljoin
import re


# NSW School Term Dates - UPDATED with 2027
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



class LakeMacSeleniumScraper:
    def __init__(self, headless=True):
        """
        Initialize Selenium scraper
        Args:
            headless: Run browser in headless mode (no GUI)
        """
        self.base_url = "https://www.lakemac.com.au"
        
        # All three URLs to scrape for events
        self.events_urls = [
            "https://library.lakemac.com.au/Events",
            "https://library.lakemac.com.au/Whats-On/Festivals-Exhibitions",
            "https://library.lakemac.com.au/Kids"
        ]
        
        # Keywords to filter family/kids events
        self.family_keywords = [
            'family', 'toddler', 'babies', 'baby', 'bubs', 'bubba', 'mummabubba',
            'kids', 'teen', 'art starter', 'art play', 'art explorers', 'storytime',
            'rhymetime', 'dungeons', 'lego', 'code', 'stem', 'steam', 'children',
            'school holiday', 'playgroup', 'rock', 'rhyme', 'story stomp'
        ]
        
        # Venue coordinates for matching locations
        self.venue_coordinates = {
            'Belmont Library': {'latitude': -33.0377372, 'longitude': 151.6584921},
            'Cardiff Library': {'latitude': -32.939776, 'longitude': 151.6557949},
            'Charlestown Library': {'latitude': -32.9626933, 'longitude': 151.694415},
            'Morisset Library': {'latitude': -33.107339, 'longitude': 151.4847661},
            'Multi-Arts Pavilion (MAP mima) Lake Macquarie': {'latitude': -32.962162, 'longitude': 151.6127815},
            'Speers Point Library': {'latitude': -32.959858, 'longitude': 151.6199961},
            'Sugar Valley Library Museum': {'latitude': -32.9161822, 'longitude': 151.5959919},
            'Swansea Library': {'latitude': -33.0920304, 'longitude': 151.635002},
            'Toronto Library': {'latitude': -33.0146088, 'longitude': 151.5956694},
            'Windale Hub': {'latitude': -32.9933612, 'longitude': 151.6789841},
        }
        
        self.driver = self._setup_driver(headless)
    
    def _setup_driver(self, headless):
        """Setup Chrome WebDriver with options"""
        chrome_options = Options()
        
        if headless:
            chrome_options.add_argument("--headless=new")
        
        chrome_options.add_argument("--disable-gpu")
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--window-size=1920,1080")
        
        try:
            driver = webdriver.Chrome(options=chrome_options)
            return driver
        except Exception as e:
            print(f"Error setting up Chrome driver: {e}")
            print("\nMake sure you have Chrome and ChromeDriver installed.")
            raise
    
    def _is_family_event(self, event_name):
        """Check if event name contains any family keywords"""
        if not event_name or event_name == 'N/A':
            return False
        
        event_name_lower = event_name.lower()
        return any(keyword.lower() in event_name_lower for keyword in self.family_keywords)
    
    def get_all_events(self, wait_time=10, scroll_pages=3):
        """
        Scrape events from all URLs, visit each event page for details
        """
        print("PHASE 1: Collecting event titles and URLs")
        print("=" * 80)
        
        all_basic_events = []
        
        # Phase 1: Get basic event info (title + URL) from all pages
        for url in self.events_urls:
            print(f"\nScraping listing page: {url}")
            events = self.get_basic_events(url, wait_time, scroll_pages)
            all_basic_events.extend(events)
            time.sleep(2)
        
        # Filter by family keywords
        family_events = [e for e in all_basic_events if self._is_family_event(e.get('name'))]
        
        print(f"\n{'='*80}")
        print(f"Found {len(all_basic_events)} total events")
        print(f"Found {len(family_events)} family/kids events (after keyword filter)")
        print(f"{'='*80}\n")
        
        # Phase 2: Visit each event URL to get detailed information
        print("\nPHASE 2: Visiting each event page for details")
        print("=" * 80)
        
        detailed_events = []
        for i, event in enumerate(family_events, 1):
            print(f"\n[{i}/{len(family_events)}] Processing: {event['name']}")
            print(f"  URL: {event['url']}")
            
            result = self.get_event_details(event['url'], event['name'])
            
            if result:
                # Check if result is a list of sub-events or a single event
                if isinstance(result, list):
                    # Sub-events found - add all of them, skip original
                    print(f"  ✓ Added {len(result)} sub-events (original event deleted)")
                    detailed_events.extend(result)
                else:
                    # Single event
                    detailed_events.append(result)
                    print(f"  ✓ Successfully extracted details")
            else:
                print(f"  ✗ No valid event found (might be 'No results found' page)")
            
            time.sleep(1.5)  # Be respectful to the server
        
        print(f"\n{'='*80}")
        print(f"FINAL SUMMARY:")
        print(f"Initial family events: {len(family_events)}")
        print(f"Valid detailed events: {len(detailed_events)}")
        print(f"{'='*80}\n")
        
        # Add coordinates to all events
        detailed_events = self._add_coordinates_to_events(detailed_events)
        
        # Expand recurring term-time events into specific dates
        detailed_events = self._expand_recurring_events(detailed_events)
        
        return detailed_events
    
    def get_basic_events(self, url, wait_time=10, scroll_pages=3):
        """
        Get basic event info (title and URL only) from listing pages
        """
        try:
            print(f"  Fetching page: {url}")
            self.driver.get(url)
            
            # Wait for articles to be present
            try:
                WebDriverWait(self.driver, 15).until(
                    EC.presence_of_all_elements_located((By.CSS_SELECTOR, "div.list-item-container article"))
                )
            except TimeoutException:
                print("  ⚠ Timeout waiting for events to load")
                return []
            
            time.sleep(2)  # Let JS finish rendering
            
            # Find all event articles
            articles = self.driver.find_elements(By.CSS_SELECTOR, "div.list-item-container article")
            print(f"  Found {len(articles)} event containers")
            
            events = []
            seen_urls = set()
            
            for article in articles:
                try:
                    link_elem = article.find_element(By.TAG_NAME, 'a')
                    title_elem = link_elem.find_element(By.CSS_SELECTOR, 'h2.list-item-title')
                    
                    name = title_elem.text.strip()
                    href = link_elem.get_attribute('href')
                    
                    if href and name and len(name) > 3:
                        full_url = urljoin(self.base_url, href) if not href.startswith('http') else href
                        
                        if full_url not in seen_urls and full_url != url:
                            events.append({
                                'name': name,
                                'url': full_url
                            })
                            seen_urls.add(full_url)
                except Exception as e:
                    continue
            
            print(f"  Found {len(events)} events")
            return events
            
        except Exception as e:
            print(f"  Error scraping {url}: {e}")
            return []
    
    def get_event_details(self, url, original_name):
        """
        Visit an event URL and extract detailed information
        Handles different page types:
        1. Direct event pages with When/Location
        2. Pages with "No results found"
        3. Pages with event listings requiring another click
        
        Returns:
        - None if no results found or error
        - Single event dict for direct event pages
        - List of event dicts if sub-events found (original event should be deleted)
        """
        try:
            self.driver.get(url)
            time.sleep(2)
            
            page_source = self.driver.page_source
            soup = BeautifulSoup(page_source, 'html.parser')
            
            # Check for "No results found"
            if self._check_no_results(soup):
                print(f"    → 'No results found' - skipping")
                return None
            
            # Check if this is a listing page with multiple events
            event_links = self._find_event_listings(soup)
            
            if event_links:
                print(f"    → Found {len(event_links)} sub-events, processing all...")
                print(f"    → Original event will be replaced by sub-events")
                # Process ALL sub-events and return them as a list
                sub_events = []
                for sub_event_info in event_links:
                    result = self._process_sub_event(sub_event_info)
                    if result:
                        # Result can be a single event or list of events (multiple locations)
                        if isinstance(result, list):
                            sub_events.extend(result)
                        else:
                            sub_events.append(result)
                
                # Return list to indicate sub-events found (caller should delete original)
                return sub_events if sub_events else None
            
            # This is a direct event page - extract details
            event = self._extract_event_details(soup, url, original_name)
            return event
            
        except Exception as e:
            print(f"    Error getting details: {e}")
            return None
    
    def _check_no_results(self, soup):
        """Check if page shows 'No results found'"""
        no_results_texts = [
            'no results found',
            'no events found',
            '0 result',
            'nothing found'
        ]
        
        page_text = soup.get_text().lower()
        return any(text in page_text for text in no_results_texts)
    
    def _find_event_listings(self, soup):
        """
        Find event listings on pages with multiple events
        ONLY looks within oc-quick-list-grid structure to avoid header/footer links
        Returns list of event links/elements
        """
        event_links = []
        
        # ONLY look for the specific oc-quick-list-grid structure
        # This is the container that holds actual event listings
        quick_list = soup.find('div', class_='oc-quick-list-grid')
        
        if quick_list:
            print(f"    → Detected event listing page (oc-quick-list-grid)")
            
            # Find all list-item-container divs within the grid ONLY
            list_items = quick_list.find_all('div', class_='list-item-container')
            
            print(f"    → Found {len(list_items)} list-item-container divs")
            
            for item in list_items:
                # Find the article and link within each list item
                article = item.find('article')
                if article:
                    link = article.find('a', href=True)
                    if link:
                        href = link.get('href', '')
                        # Get the h2 title
                        h2 = link.find('h2', class_='list-item-title')
                        name = h2.get_text(strip=True) if h2 else link.get_text(strip=True)
                        
                        if href and name and len(name) > 3:
                            full_url = urljoin(self.base_url, href) if not href.startswith('http') else href
                            event_links.append({
                                'name': name,
                                'url': full_url
                            })
                            print(f"      → Found sub-event: {name}")
        
        # Remove duplicates
        seen = set()
        unique_links = []
        for link in event_links:
            if link['url'] not in seen:
                seen.add(link['url'])
                unique_links.append(link)
        
        if unique_links:
            print(f"    → Total unique sub-events: {len(unique_links)}")
        
        return unique_links
    
    def _process_sub_event(self, event_info):
        """
        Process a sub-event by visiting its URL
        event_info: dict with 'name' and 'url'
        Returns single event dict or list of event dicts if multiple locations
        """
        try:
            print(f"      → Visiting sub-event: {event_info['name']}")
            self.driver.get(event_info['url'])
            time.sleep(2)
            
            page_source = self.driver.page_source
            soup = BeautifulSoup(page_source, 'html.parser')
            
            # Extract details using the sub-event's name and URL
            result = self._extract_event_details(soup, event_info['url'], event_info['name'])
            
            # Result can be a single event or a list of events (multiple locations)
            return result
            
        except Exception as e:
            print(f"      Error processing sub-event: {e}")
            return None
    
    def _extract_event_details(self, soup, url, name):
        """
        Extract event details from an event page
        Looking for "When" and "Location" sections
        Returns single event or list of events if multiple locations/dates found
        """
        # Check if this page has multiple locations (like Books & Babies)
        multiple_events = self._extract_multiple_location_events(soup, url, name)
        if multiple_events:
            return multiple_events
        
        # Single location - extract event details
        event = {
            'name': name,
            'url': url,
            'readable_date': 'N/A',
            'start_date': None,
            'location': 'N/A'
        }
        
        # Look for "When" section
        when_section = self._find_section_by_label(soup, ['when', 'date', 'time'])
        if when_section:
            when_text = when_section.get_text(strip=True)
            event['readable_date'] = when_text
            # Try to parse dates - now returns datetime object
            start_date = self._parse_start_date(when_text)
            if start_date:
                event['start_date'] = start_date
        
        # Look for "Location" section - UPDATED to find <h2 class="sub-title">Location</h2>
        location = self._find_location(soup)
        if location:
            event['location'] = location
        
        # Check if we need to expand this into multiple date-specific events
        expanded_events = self._expand_event_by_dates(event)
        if expanded_events:
            return expanded_events
        
        return event
    
    def _find_location(self, soup):
        """
        Find location from <h2 class="sub-title">Location</h2> followed by <p> tag
        Returns cleaned location text or None
        """
        # Find h2 with class="sub-title" and text "Location"
        location_headers = soup.find_all('h2', class_='sub-title')
        
        for header in location_headers:
            if header.get_text(strip=True).lower() == 'location':
                # Found the location header, now get the next <p> tag
                p_tag = header.find_next_sibling('p')
                if p_tag:
                    # Get text and clean it up
                    location_text = p_tag.get_text(separator=' ', strip=True)
                    
                    # Remove "View in Google Maps" link text
                    location_text = re.sub(r'View in Google Maps', '', location_text)
                    
                    # Clean up extra whitespace
                    location_text = re.sub(r'\s+', ' ', location_text).strip()
                    
                    return location_text
        
        return None
    
    def _expand_event_by_dates(self, event):
        """
        If an event has multiple dates, expand it into separate events for each date
        Handles two cases:
        1. Multiple specific dates listed (creates one event per future date)
        2. Date range (creates events for first 7 days or until end date, whichever is sooner)
        Returns list of events or None if single date
        """
        # We need to check the original page for multi-date structure
        # This requires re-visiting the page to get the multi-date-list
        try:
            self.driver.get(event['url'])
            time.sleep(1)
            
            page_source = self.driver.page_source
            soup = BeautifulSoup(page_source, 'html.parser')
            
            # Look for multi-date-list container
            multi_date_container = soup.find('div', class_='multi-date-list-container')
            
            if not multi_date_container:
                return None
            
            # Find future events list
            future_events = multi_date_container.find('ul', class_='future-events-list')
            
            if not future_events:
                return None
            
            # Get all future date items
            date_items = future_events.find_all('li', class_='multi-date-item')
            
            if not date_items:
                return None
            
            expanded_events = []
            
            # Check if this is a date range (single item with long duration) or multiple specific dates
            if len(date_items) == 1:
                # Single item - check if it's a date range
                item = date_items[0]
                expanded = self._expand_date_range(event, item)
                if expanded:
                    expanded_events.extend(expanded)
            else:
                # Multiple specific dates
                for item in date_items:
                    date_event = self._create_event_from_date_item(event, item)
                    if date_event:
                        expanded_events.append(date_event)
            
            if len(expanded_events) > 1:
                print(f"      → Expanded into {len(expanded_events)} date-specific events")
                return expanded_events
            
            return None
            
        except Exception as e:
            print(f"      Error expanding dates: {e}")
            return None
    
    def _expand_date_range(self, base_event, date_item):
        """
        Expand a date range into multiple events (max 7 days), starting from today
        """
        from datetime import datetime, timedelta
        
        try:
            # Parse start and end dates from the event
            start_year = int(date_item.get('data-start-year'))
            start_month = int(date_item.get('data-start-month'))
            start_day = int(date_item.get('data-start-day'))
            start_hour = int(date_item.get('data-start-hour'))
            start_mins = int(date_item.get('data-start-mins'))
            
            end_year = int(date_item.get('data-end-year'))
            end_month = int(date_item.get('data-end-month'))
            end_day = int(date_item.get('data-end-day'))
            end_hour = int(date_item.get('data-end-hour'))
            end_mins = int(date_item.get('data-end-mins'))
            
            start_date = datetime(start_year, start_month, start_day, start_hour, start_mins)
            end_date = datetime(end_year, end_month, end_day, end_hour, end_mins)
            
            # Use today's date as the effective start if the event starts in the past
            today = datetime.today().replace(hour=start_hour, minute=start_mins, second=0, microsecond=0)
            effective_start = max(start_date, today)
            
            # Calculate duration from effective start
            duration = (end_date - effective_start).days
            
            if duration >= 0:
                events = []
                # Create events for first 7 days or until end date
                days_to_create = min(7, duration + 1)
                
                for i in range(days_to_create):
                    event_date = effective_start + timedelta(days=i)
                    event_end = event_date.replace(hour=end_hour, minute=end_mins)
                    
                    when_text = f"{event_date.strftime('%A, %d %B %Y')} | {event_date.strftime('%I:%M %p')} - {event_end.strftime('%I:%M %p')}"
                    
                    new_event = {
                        'name': base_event['name'],
                        'url': base_event['url'],
                        'readable_date': when_text,
                        'start_date': event_date.isoformat(),
                        'location': base_event['location']
                    }
                    events.append(new_event)
                
                return events
            else:
                # Event ended in the past
                return None
                
        except Exception as e:
            print(f"        Error expanding date range: {e}")
            return None



    def _create_event_from_date_item(self, base_event, date_item):
        """
        Create a single event from a multi-date-item
        """
        from datetime import datetime
        
        try:
            start_year = int(date_item.get('data-start-year'))
            start_month = int(date_item.get('data-start-month'))
            start_day = int(date_item.get('data-start-day'))
            start_hour = int(date_item.get('data-start-hour'))
            start_mins = int(date_item.get('data-start-mins'))
            
            end_hour = int(date_item.get('data-end-hour'))
            end_mins = int(date_item.get('data-end-mins'))
            
            start_date = datetime(start_year, start_month, start_day, start_hour, start_mins)
            end_time = datetime(start_year, start_month, start_day, end_hour, end_mins)
            
            when_text = f"{start_date.strftime('%A, %d %B %Y')} | {start_date.strftime('%I:%M %p')} - {end_time.strftime('%I:%M %p')}"
            
            event = {
                'name': base_event['name'],
                'url': base_event['url'],
                'readable_date': when_text,
                'start_date': start_date.isoformat(),
                'location': base_event['location']
            }
            
            return event
            
        except Exception as e:
            print(f"        Error creating event from date item: {e}")
            return None
    
    def _extract_multiple_location_events(self, soup, url, name):
        """
        Extract multiple events when a page lists multiple locations with dates
        Example: Books & Babies lists 9 different library locations
        Returns list of events or None if not a multi-location page
        """
        events = []
        
        # Look for pattern: <strong>Location Name</strong> followed by <em>address</em> and time info
        # Find all <strong> tags that might be location headers
        strong_tags = soup.find_all('strong')
        
        for strong in strong_tags:
            location_name = strong.get_text(strip=True)
            
            # Check if this looks like a library/venue name
            if not location_name or len(location_name) < 3:
                continue
            
            # Skip if it's just generic headings
            if location_name.lower() in ['when', 'where', 'cost', 'contact', 'description']:
                continue
            
            # Get the parent paragraph
            current = strong.parent
            if not current:
                continue
            
            address = None
            when_text = None
            
            # Look at next few siblings for address (<em>) and time info
            # Limit to 5 siblings to capture the pattern
            for i in range(5):
                next_sibling = current.find_next_sibling()
                if not next_sibling:
                    break
                current = next_sibling
                
                # Get the text content
                text = current.get_text(strip=True)
                
                # Skip empty paragraphs or just whitespace
                if not text or text == '&nbsp;':
                    continue
                
                # Check for address in <em> tag (should come first)
                em = current.find('em')
                if em and not address:
                    address = em.get_text(strip=True)
                    continue
                
                # Check for time info (contains "every" or "am"/"pm")
                # This should come after the address
                if not when_text and address:
                    if ('every' in text.lower() or 'am' in text.lower() or 'pm' in text.lower()):
                        # Make sure this isn't another address (addresses contain numbers)
                        if not re.search(r'\d{4}', text):  # No postcodes
                            when_text = text
                            break
            
            # If we found both location and timing info, create an event
            if address and when_text:
                # Try to parse the date
                start_date = self._parse_start_date(when_text)
                
                event = {
                    'name': f"{name} - {location_name}",
                    'url': url,
                    'readable_date': when_text,
                    'start_date': start_date,
                    'location': f"{location_name}, {address}"
                }
                
                events.append(event)
                print(f"        → Created event for: {location_name}")
            elif address and not when_text:
                # Found location but no time - might need to look further
                print(f"        → Found {location_name} but missing time info")
        
        # Return events if we found multiple locations, otherwise None
        if len(events) > 1:
            print(f"      → Split into {len(events)} location-specific events")
            return events
        
        return None
    
    def _find_section_by_label(self, soup, labels):
        """
        Find a section that has a label matching the given terms
        Returns the content element (not the label)
        """
        for label in labels:
            # Look for elements containing the label
            label_elem = soup.find(string=re.compile(f'^{label}', re.IGNORECASE))
            
            if label_elem:
                # Get the parent and look for content nearby
                parent = label_elem.parent
                
                # Check if content is in a sibling element
                if parent:
                    # Try next sibling
                    next_sibling = parent.find_next_sibling()
                    if next_sibling:
                        return next_sibling
                    
                    # Try within the same parent
                    content = parent.find_next(string=True)
                    if content:
                        return parent
        
        return None
    
    def _parse_start_date(self, when_text):
        """
        Parse start date from "when" text and return as ISO format datetime string
        Example: "Monday, 27 October 2025 | 09:00 AM - Friday, 30 January 2026 | 05:00 PM"
        Returns: ISO format datetime string (e.g., "2025-10-27T09:00:00") or None
        
        NOTE: This does NOT parse recurring patterns like "Every Tuesday 11am"
        Those are handled by _expand_recurring_events() later
        """
        if not when_text or when_text == 'N/A':
            return None
        
        # Skip recurring patterns - these will be expanded later
        if any(keyword in when_text.lower() for keyword in ['every', 'each', 'weekly']):
            return None
        
        # Pattern: Day, DD Month YYYY | HH:MM AM/PM
        date_pattern = r'(\w+),\s+(\d{1,2})\s+(\w+)\s+(\d{4})\s*\|\s*(\d{1,2}):(\d{2})\s*([AP]M)'
        match = re.search(date_pattern, when_text)
        
        if match:
            try:
                day_name, day, month_name, year, hour, minute, am_pm = match.groups()
                
                # Convert month name to number
                month_map = {
                    'january': 1, 'february': 2, 'march': 3, 'april': 4,
                    'may': 5, 'june': 6, 'july': 7, 'august': 8,
                    'september': 9, 'october': 10, 'november': 11, 'december': 12
                }
                month = month_map.get(month_name.lower())
                
                if not month:
                    return None
                
                # Convert to 24-hour format
                hour = int(hour)
                if am_pm == 'PM' and hour != 12:
                    hour += 12
                elif am_pm == 'AM' and hour == 12:
                    hour = 0
                
                # Create datetime object
                dt = datetime(int(year), month, int(day), hour, int(minute))
                
                # Return as ISO format string
                return dt.isoformat()
                
            except Exception as e:
                print(f"        Error parsing date: {e}")
                return None
        
        return None
    
    def _add_coordinates_to_events(self, events):
        """
        Add latitude and longitude to each event based on the location field
        Matches the venue name (text before first comma) against venue_coordinates
        """
        for event in events:
            location = event.get('location', 'N/A')
            
            # Initialize coordinates as None
            event['latitude'] = None
            event['longitude'] = None
            
            if location and location != 'N/A':
                # Extract venue name (everything before first comma)
                venue_name = location.split(',')[0].strip()
                
                # Try to match against known venues
                if venue_name in self.venue_coordinates:
                    coords = self.venue_coordinates[venue_name]
                    event['latitude'] = coords['latitude']
                    event['longitude'] = coords['longitude']
                else:
                    # Try partial matching (case-insensitive)
                    venue_name_lower = venue_name.lower()
                    for known_venue, coords in self.venue_coordinates.items():
                        if known_venue.lower() in venue_name_lower or venue_name_lower in known_venue.lower():
                            event['latitude'] = coords['latitude']
                            event['longitude'] = coords['longitude']
                            break
        
        return events
    
    def _expand_recurring_events(self, events):
        """
        Expand recurring events (e.g., "Every Tuesday 11am (excluding school holidays)")
        into individual dated events for each occurrence during NSW school terms
        Limited to next 30 days only
        KEEPS the original recurring event AND adds date-specific instances
        """
        expanded_events = []
        today = datetime.today().date()
        one_month_from_now = today + timedelta(days=30)
        
        for event in events:
            when_text = event.get('readable_date', '').lower()
            
            # Check if this is a recurring event with term-time restrictions
            is_recurring = any(keyword in when_text for keyword in [
                'every', 'each', 'weekly', 'in term time', 'excluding school holidays',
                'term time only', 'during school term'
            ])
            
            if not is_recurring:
                # Not recurring - keep as is
                expanded_events.append(event)
                continue
            
            # This IS a recurring event
            # ALWAYS keep the original with its descriptive text
            expanded_events.append(event)
            
            # Try to parse and create specific dated instances
            recurring_dates = self._parse_recurring_pattern(when_text, today, one_month_from_now)
            
            if recurring_dates and len(recurring_dates) > 0:
                print(f"  → Expanding recurring event: {event['name']}")
                print(f"     Keeping original + adding {len(recurring_dates)} specific instances")
                
                # Create a separate event for each occurrence
                for occurrence_date, time_str in recurring_dates:
                    new_event = event.copy()
                    new_event['readable_date'] = f"{occurrence_date.strftime('%A, %d %B %Y')} | {time_str}"
                    new_event['start_date'] = occurrence_date.isoformat()
                    expanded_events.append(new_event)
        
        return expanded_events
    
    def _parse_recurring_pattern(self, when_text, today, end_date):
        """
        Parse recurring event pattern and generate list of occurrence dates
        Only includes dates between today and end_date (30 days from now)
        Returns: List of (date, time_string) tuples
        """
        # Day of week mapping
        day_names = {
            'monday': 0, 'tuesday': 1, 'wednesday': 2, 'thursday': 3,
            'friday': 4, 'saturday': 5, 'sunday': 6
        }
        
        # Find the day of week
        target_day = None
        for day_name, day_num in day_names.items():
            if day_name in when_text:
                target_day = day_num
                break
        
        if target_day is None:
            return None
        
        # Find the time (e.g., "11am", "2:30pm", "10:00 am")
        time_pattern = r'(\d{1,2})(?::(\d{2}))?\s*([ap]m)'
        time_match = re.search(time_pattern, when_text)
        
        if not time_match:
            return None
        
        hour = int(time_match.group(1))
        minute = int(time_match.group(2)) if time_match.group(2) else 0
        am_pm = time_match.group(3)
        
        # Convert to 24-hour format
        if am_pm == 'pm' and hour != 12:
            hour += 12
        elif am_pm == 'am' and hour == 12:
            hour = 0
        
        time_str = f"{hour:02d}:{minute:02d}"
        time_display = f"{int(time_match.group(1)):02d}:{minute:02d} {am_pm.upper()}"
        
        # Get all term dates for current and next years
        occurrences = []
        
        for year in [2025, 2026, 2027]:
            if year not in SCHOOL_TERM_DATES:
                continue
            
            terms = SCHOOL_TERM_DATES[year]["terms"]["eastern_nsw"]
            
            for term_name, start_str, end_str in terms:
                term_start = datetime.strptime(start_str, "%Y-%m-%d").date()
                term_end = datetime.strptime(end_str, "%Y-%m-%d").date()
                
                # Find all occurrences of target_day within this term
                current_date = term_start
                
                # Move to first occurrence of target day
                while current_date.weekday() != target_day:
                    current_date += timedelta(days=1)
                    if current_date > term_end:
                        break
                
                # Add all occurrences of this day in the term
                while current_date <= term_end:
                    # Only include dates within our 30-day window
                    if today <= current_date <= end_date:
                        occurrence_datetime = datetime.combine(current_date, datetime.min.time())
                        occurrence_datetime = occurrence_datetime.replace(hour=hour, minute=minute)
                        occurrences.append((occurrence_datetime, time_display))
                    
                    current_date += timedelta(days=7)  # Next week
        
        return occurrences if occurrences else None
    
    def _scroll_page(self, num_scrolls):
        """Scroll page to trigger lazy loading"""
        for i in range(num_scrolls):
            self.driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            time.sleep(1)
        self.driver.execute_script("window.scrollTo(0, 0);")
        time.sleep(1)
    
    def upload_to_supabase(self, events, supabase_url, supabase_key, table='events_lakemac'):
        """Upload events to Supabase"""
        if not events:
            print("No events to upload.")
            return
        supabase: Client = create_client(supabase_url, supabase_key)
        columns = ['name', 'url', 'readable_date', 'start_date', 'location', 'latitude', 'longitude']
        clean = [{k: e.get(k) for k in columns} for e in events if 'error' not in e]
        supabase.table(table).delete().neq('name', '').execute()
        supabase.table(table).insert(clean).execute()
        print(f"Uploaded {len(clean)} records to {table}")
    
    def print_events(self, events):
        """Pretty print the events"""
        if not events:
            print("No family/kids events found.")
            return
        
        print(f"\nFound {len(events)} family/kids event(s) with details:\n")
        print("=" * 80)
        
        for i, event in enumerate(events, 1):
            print(f"\nEvent #{i}")
            print(f"Name: {event.get('name', 'N/A')}")
            print(f"URL: {event.get('url', 'N/A')}")
            print(f"Readable Date: {event.get('readable_date', 'N/A')}")
            print(f"Start Date (ISO): {event.get('start_date', 'N/A')}")
            print(f"Location: {event.get('location', 'N/A')}")
            print(f"Latitude: {event.get('latitude', 'N/A')}")
            print(f"Longitude: {event.get('longitude', 'N/A')}")
            print("-" * 80)
    
    def close(self):
        """Close the browser"""
        if self.driver:
            self.driver.quit()
    
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()


def main():
    import os
    
    print("Lake Macquarie Family/Kids Events Scraper")
    print("=" * 80)
    print("This scraper will:")
    print("1. Collect event titles and URLs from listing pages")
    print("2. Filter for family/kids events based on keywords")
    print("3. Visit each event page to extract detailed information")
    print("4. Handle 'No results found' pages and sub-listings")
    print("5. Expand recurring term-time events into specific dates")
    print("6. Upload to Supabase")
    print("=" * 80)
    print()
    
    # Get Supabase credentials from environment variables
    supabase_url = os.getenv('SUPABASE_URL')
    supabase_key = os.getenv('SUPABASE_KEY')
    
    if not supabase_url or not supabase_key:
        print("ERROR: SUPABASE_URL and SUPABASE_KEY environment variables must be set")
        return None
    
    with LakeMacSeleniumScraper(headless=True) as scraper:
        events = scraper.get_all_events(wait_time=10, scroll_pages=3)
        
        if events:
            print(f"\n✓ Successfully scraped {len(events)} events")
            scraper.print_events(events)
            scraper.upload_to_supabase(events, supabase_url, supabase_key)
        else:
            print("\n✗ No family/kids events found with valid details.")
            print("⚠ Supabase credentials missing or no events scraped.")
    
    return events


if __name__ == "__main__":
    events = main()
