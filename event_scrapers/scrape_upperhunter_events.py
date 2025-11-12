from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from datetime import datetime
import json
import re
import time

def setup_driver():
    """
    Setup Chrome driver with options to avoid detection
    """
    chrome_options = Options()
    
    # Anti-detection options
    chrome_options.add_argument('--disable-blink-features=AutomationControlled')
    chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
    chrome_options.add_experimental_option('useAutomationExtension', False)
    chrome_options.add_argument('--disable-dev-shm-usage')
    chrome_options.add_argument('--no-sandbox')
    
    # Use a realistic user agent
    chrome_options.add_argument('user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
    
    # Run headless
    chrome_options.add_argument('--headless')
    
    driver = webdriver.Chrome(options=chrome_options)
    
    # Remove webdriver property
    driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
    
    return driver

def extract_event_datetime(driver, event_url):
    """
    Visit an individual event page and extract the datetime
    """
    try:
        driver.get(event_url)
        
        # Wait for the date element to load
        wait = WebDriverWait(driver, 10)
        date_elem = wait.until(
            EC.presence_of_element_located((By.CLASS_NAME, 'event-date'))
        )
        
        date_text = date_elem.text.strip()
        
        # Parse format like "Next date: Friday, 14 November 2025 | 10:00 AM to 11:00 AM"
        match = re.search(r'(\d{1,2}\s+\w+\s+\d{4})\s*\|\s*(\d{1,2}:\d{2}\s*(?:AM|PM))', date_text)
        
        if match:
            date_part = match.group(1)
            time_part = match.group(2)
            
            try:
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
        return locations['scone']
    
    location_lower = location_text.lower()
    for key, loc_data in locations.items():
        if key in location_lower:
            return loc_data
    
    parts = location_text.split(',')
    if parts:
        return {
            'name': parts[0].strip(),
            'latitude': None,
            'longitude': None
        }
    
    return locations['scone']

def scrape_upperhunter_library_events():
    """
    Scrape events from Upper Hunter Library website using Selenium
    """
    base_url = "https://www.upperhunter.nsw.gov.au/Events-Activities"
    
    keywords = [
        'family', 'toddler', 'babies', 'baby', 'bubs', 'bubba', 'mummabubba',
        'kids', 'teen', 'art starter', 'art play', 'art explorers', 'storytime',
        'rhymetime', 'dungeons', 'lego', 'code', 'stem', 'steam', 'children',
        'school holiday', 'playgroup', 'rock', 'rhyme', 'story stomp', 'little ones',
        'story time', 'craft'
    ]
    
    driver = setup_driver()
    all_event_data = []
    page_num = 1
    
    print("Collecting events from all pages...")
    
    try:
        # Load the first page
        print(f"Fetching page {page_num}...")
        driver.get(base_url)
        
        # Wait for events to load
        wait = WebDriverWait(driver, 10)
        wait.until(EC.presence_of_element_located((By.CLASS_NAME, 'list-item-container')))
        time.sleep(2)
        
        while True:
            try:
                print(f"Processing page {page_num}...")
                
                # Find all event items
                event_items = driver.find_elements(By.CLASS_NAME, 'list-item-container')
                
                if not event_items:
                    print(f"No events found on page {page_num}")
                    break
                
                for item in event_items:
                    try:
                        # Extract title and URL
                        article = item.find_element(By.TAG_NAME, 'article')
                        link = article.find_element(By.TAG_NAME, 'a')
                        title_elem = link.find_element(By.CLASS_NAME, 'list-item-title')
                        
                        title = title_elem.text.strip()
                        event_url = link.get_attribute('href')
                        
                        # Check if title contains any keyword
                        if not any(keyword.lower() in title.lower() for keyword in keywords):
                            continue
                        
                        # Extract description
                        try:
                            desc_elem = link.find_element(By.CLASS_NAME, 'list-item-block-desc')
                            description = desc_elem.text.strip()
                        except:
                            description = ''
                        
                        # Extract location
                        try:
                            location_elem = item.find_element(By.CLASS_NAME, 'list-item-address')
                            location_text = location_elem.text.strip()
                        except:
                            location_text = ''
                        
                        all_event_data.append({
                            'title': title,
                            'url': event_url,
                            'description': description,
                            'location_text': location_text
                        })
                        
                    except Exception as e:
                        print(f"Error parsing event item: {e}")
                        continue
                
                # Check if there's a next page link that's clickable
                try:
                    # Check if the next button is disabled (it will be a span, not an a tag)
                    disabled_next = driver.find_elements(By.CSS_SELECTOR, 'li.disabled span.next')
                    if disabled_next:
                        print(f"Reached last page at page {page_num}")
                        break
                    
                    # Find and click the next button
                    next_link = driver.find_element(By.CSS_SELECTOR, 'a.page-link.next')
                    print(f"Clicking next button to go to page {page_num + 1}...")
                    next_link.click()
                    
                    # Wait for the page to update
                    time.sleep(2)
                    wait.until(EC.presence_of_element_located((By.CLASS_NAME, 'list-item-container')))
                    
                    page_num += 1
                    
                except Exception as e:
                    print(f"No more pages or error clicking next: {e}")
                    print(f"Reached last page at page {page_num}")
                    break
                
            except Exception as e:
                print(f"Error processing page {page_num}: {e}")
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
                'location': location_data,
                'url': event_data['url']
            }
            
            events.append(event)
            time.sleep(1)  # Be polite between requests
        
        return events
        
    finally:
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
