from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from bs4 import BeautifulSoup
from datetime import datetime
import os
import re
import time
from supabase import create_client, Client

def setup_driver():
    """Setup Selenium Chrome driver with options"""
    chrome_options = Options()
    chrome_options.add_argument('--headless')
    chrome_options.add_argument('--no-sandbox')
    chrome_options.add_argument('--disable-dev-shm-usage')
    chrome_options.add_argument('--disable-blink-features=AutomationControlled')
    chrome_options.add_argument('--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
    
    driver = webdriver.Chrome(options=chrome_options)
    return driver

def extract_event_datetime(driver, event_url):
    """
    Visit an individual event page and extract the datetime
    """
    try:
        driver.get(event_url)
        time.sleep(2)  # Wait for page to load
        
        soup = BeautifulSoup(driver.page_source, 'html.parser')
        
        # Find the event date paragraph
        date_elem = soup.find('p', class_='event-date')
        
        if not date_elem:
            return None
        
        date_text = date_elem.text.strip()
        
        # Parse format like "Next date: Friday, 14 November 2025 | 10:00 AM to 11:00 AM"
        # Extract the datetime part
        match = re.search(r'(\d{1,2}\s+\w+\s+\d{4})\s*\|\s*(\d{1,2}:\d{2}\s*(?:AM|PM))', date_text)
        
        if match:
            date_part = match.group(1)  # "14 November 2025"
            time_part = match.group(2)  # "10:00 AM"
            
            try:
                # Combine and parse
                datetime_str = f"{date_part} {time_part}"
                event_datetime = datetime.strptime(datetime_str, '%d %B %Y %I:%M %p')
                return event_datetime.strftime('%Y-%m-%d %H:%M')
            except Exception as e:
                print(f"Error parsing datetime '{datetime_str}': {e}")
                return date_text
        
        return date_text
        
    except Exception as e:
        print(f"Error extracting datetime from {event_url}: {e}")
        return None

def parse_location(location_text):
    """
    Parse location text and return location details with coordinates
    """
    # Map of library locations to coordinates
    locations = {
        'murrurundi': {
            'name': 'Murrurundi Library',
            'latitude': -31.7667,
            'longitude': 150.8333
        },
        'scone': {
            'name': 'Scone Library',
            'latitude': -32.0500,
            'longitude': 150.8667
        },
        'merriwa': {
            'name': 'Merriwa Library',
            'latitude': -32.1500,
            'longitude': 150.4167
        },
        'aberdeen': {
            'name': 'Aberdeen Library',
            'latitude': -32.1667,
            'longitude': 150.8833
        }
    }
    
    if not location_text:
        return locations['scone']  # Default
    
    # Check which location is mentioned
    location_lower = location_text.lower()
    for key, loc_data in locations.items():
        if key in location_lower:
            return loc_data
    
    # If not found, try to extract the name from the text
    # Format: "Murrurundi Library, 47 Mayne Street, Murrurundi 2338"
    parts = location_text.split(',')
    if parts:
        return {
            'name': parts[0].strip(),
            'latitude': None,
            'longitude': None
        }
    
    return locations['scone']  # Default

def scrape_upperhunter_library_events():
    """
    Scrape events from Upper Hunter Library website using Selenium
    """
    base_url = "https://www.upperhunter.nsw.gov.au/Events-Activities"
    
    # Keywords to filter events
    keywords = [
        'family', 'toddler', 'babies', 'baby', 'bubs', 'bubba', 'mummabubba',
        'kids', 'teen', 'art starter', 'art play', 'art explorers', 'storytime',
        'rhymetime', 'dungeons', 'lego', 'code', 'stem', 'steam', 'children',
        'school holiday', 'playgroup', 'rock', 'rhyme', 'story stomp', 'little ones',
        'story time', 'craft'
    ]
    
    driver = setup_driver()
    all_event_data = []
    
    try:
        page_num = 1
        
        print("Collecting events from all pages...")
        
        # Collect all event data by paginating
        while True:
            try:
                if page_num == 1:
                    url = base_url
                else:
                    url = f"{base_url}?page={page_num}"
                
                print(f"Fetching page {page_num}...")
                driver.get(url)
                
                # Wait for content to load
                time.sleep(3)
                
                # Get page source and parse with BeautifulSoup
                soup = BeautifulSoup(driver.page_source, 'html.parser')
                
                # Find all event items
                event_items = soup.find_all('div', class_='list-item-container')
                
                if not event_items:
                    print(f"No events found on page {page_num}")
                    break
                
                for item in event_items:
                    try:
                        # Extract title and URL
                        article = item.find('article')
                        if not article:
                            continue
                        
                        link = article.find('a', href=True)
                        if not link:
                            continue
                        
                        title_elem = link.find('h2', class_='list-item-title')
                        if not title_elem:
                            continue
                        
                        title = title_elem.text.strip()
                        event_url = link['href']
                        
                        # Make URL absolute if needed
                        if not event_url.startswith('http'):
                            event_url = f"https://www.upperhunter.nsw.gov.au{event_url}"
                        
                        # Check if title contains any keyword
                        if not any(keyword.lower() in title.lower() for keyword in keywords):
                            continue
                        
                        # Extract description
                        desc_elem = link.find('span', class_='list-item-block-desc')
                        description = desc_elem.text.strip() if desc_elem else ''
                        
                        # Extract location
                        location_elem = item.find('p', class_='list-item-address')
                        location_text = location_elem.text.strip() if location_elem else ''
                        
                        all_event_data.append({
                            'title': title,
                            'url': event_url,
                            'description': description,
                            'location_text': location_text
                        })
                        
                    except Exception as e:
                        print(f"Error parsing event item: {e}")
                        continue
                
                # Check if there's a next page link
                next_link = soup.find('a', class_='page-link next')
                if not next_link or next_link.has_attr('disabled'):
                    print(f"Reached last page at page {page_num}")
                    break
                
                page_num += 1
                time.sleep(2)  # Be polite
                
            except Exception as e:
                print(f"Error fetching page {page_num}: {e}")
                break
        
        print(f"\nFound {len(all_event_data)} matching events. Fetching details...")
        
        # Now visit each event page to get datetime
        events = []
        for i, event_data in enumerate(all_event_data, 1):
            print(f"Processing event {i}/{len(all_event_data)}: {event_data['title']}")
            
            # Get datetime from event page
            datetime_str = extract_event_datetime(driver, event_data['url'])
            
            # Parse location
            location_data = parse_location(event_data['location_text'])
            
            event = {
                'title': event_data['title'],
                'description': event_data['description'],
                'datetime': datetime_str or '',
                'location': location_data['name'],
                'url': event_data['url'],
                'latitude': location_data['latitude'],
                'longitude': location_data['longitude']
            }
            
            events.append(event)
            time.sleep(1)  # Be polite between requests
        
        return events
        
    finally:
        # Always close the driver
        driver.quit()

def upload_to_supabase(events, supabase_url, supabase_key, table='events_upperhunter'):
    """
    Upload events to Supabase
    """
    if not events:
        print("No events to upload.")
        return
    
    supabase: Client = create_client(supabase_url, supabase_key)
    
    # Define columns to keep
    columns = ['title', 'description', 'datetime', 'location', 'url', 'latitude', 'longitude']
    
    # Clean the data
    clean = [{k: e.get(k) for k in columns} for e in events if 'error' not in e]
    
    # Delete existing records
    supabase.table(table).delete().neq('title', '').execute()
    
    # Insert new records
    supabase.table(table).insert(clean).execute()
    
    print(f"Uploaded {len(clean)} records to {table}")

def main():
    """Main function to run the scraper and upload to Supabase"""
    print("Scraping Upper Hunter Library events...")
    print("-" * 80)
    
    # Get Supabase credentials from environment variables
    supabase_url = os.environ.get('SUPABASE_URL')
    supabase_key = os.environ.get('SUPABASE_KEY')
    
    if not supabase_url or not supabase_key:
        print("Error: SUPABASE_URL and SUPABASE_KEY environment variables must be set")
        return
    
    # Scrape events
    events = scrape_upperhunter_library_events()
    
    if events:
        print(f"\n{'='*80}")
        print(f"Found {len(events)} family/children events\n")
        
        # Upload to Supabase
        upload_to_supabase(events, supabase_url, supabase_key)
    else:
        print("No matching events found.")

if __name__ == "__main__":
    main()
