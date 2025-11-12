import requests
from bs4 import BeautifulSoup
from datetime import datetime
import os
import time
from supabase import create_client, Client

def extract_event_details(event_url):
    """
    Visit an individual event page and extract datetime and location details
    """
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        response = requests.get(event_url, headers=headers)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Find the event details box
        details_box = soup.find('div', class_='event-details-box')
        
        if not details_box:
            return None, None, None
        
        # Extract datetime
        datetime_str = None
        date_start = details_box.find('span', class_='tribe-event-date-start')
        
        if date_start:
            date_text = date_start.text.strip()
            # Parse format like "November 13 @ 10:00 am"
            try:
                # Remove the @ symbol and parse
                date_text = date_text.replace(' @ ', ' ')
                event_datetime = datetime.strptime(date_text, '%B %d %I:%M %p')
                # Add current year (or you could extract it from the page)
                event_datetime = event_datetime.replace(year=datetime.now().year)
                datetime_str = event_datetime.strftime('%Y-%m-%d %H:%M')
            except:
                # If parsing fails, just store the raw text
                datetime_str = date_text
        
        # Extract location name
        location_name = None
        location_link = details_box.find('a', href=lambda x: x and '/venue/' in x)
        if location_link:
            location_name = location_link.text.strip()
        
        # Extract description from the main content
        description = None
        content_div = soup.find('div', class_='tribe-events-single-event-description')
        if content_div:
            # Get text from paragraphs
            paragraphs = content_div.find_all('p')
            if paragraphs:
                description = ' '.join([p.text.strip() for p in paragraphs if p.text.strip()])
        
        return datetime_str, location_name, description
        
    except Exception as e:
        print(f"Error extracting details from {event_url}: {e}")
        return None, None, None

def get_location_coordinates(location_name):
    """
    Map location names to their coordinates
    """
    locations = {
        'muswellbrook': {
            'name': 'Muswellbrook Library',
            'latitude': -32.2656,
            'longitude': 150.8892
        },
        'denman': {
            'name': 'Denman Library',
            'latitude': -32.3833,
            'longitude': 150.6833
        }
    }
    
    if location_name:
        location_key = location_name.lower()
        if location_key in locations:
            return locations[location_key]
    
    # Default to Muswellbrook if not found
    return locations['muswellbrook']

def scrape_muswellbrook_library_events():
    """
    Scrape events from Muswellbrook Library website with pagination
    """
    base_url = "https://libraries.muswellbrook.nsw.gov.au/whats-on/"
    
    # Keywords to filter events
    keywords = [
        'family', 'toddler', 'babies', 'baby', 'bubs', 'bubba', 'mummabubba',
        'kids', 'teen', 'art starter', 'art play', 'art explorers', 'storytime',
        'rhymetime', 'dungeons', 'lego', 'code', 'stem', 'steam', 'children',
        'school holiday', 'playgroup', 'rock', 'rhyme', 'story stomp', 'little ones',
        'story time', 'craft'
    ]
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
    
    all_event_links = []
    page_num = 1
    
    print("Collecting event links from all pages...")
    
    # Collect all event links by paginating
    while True:
        try:
            if page_num == 1:
                url = base_url
            else:
                url = f"{base_url}page/{page_num}/"
            
            print(f"Fetching page {page_num}...")
            response = requests.get(url, headers=headers)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # Find all event cards
            event_cards = soup.find_all('div', class_='card')
            
            if not event_cards:
                print(f"No events found on page {page_num}")
                break
            
            for card in event_cards:
                # Get title and URL
                title_link = card.find('a', class_='blank-link')
                if title_link:
                    title = title_link.text.strip()
                    event_url = title_link.get('href')
                    
                    # Check if title contains any keyword
                    if any(keyword.lower() in title.lower() for keyword in keywords):
                        all_event_links.append({
                            'title': title,
                            'url': event_url
                        })
            
            # Check if next button is disabled
            next_button = soup.find('button', class_='pagination__button', attrs={'aria-label': 'Next Events'})
            if next_button and next_button.has_attr('disabled'):
                print(f"Reached last page at page {page_num}")
                break
            
            page_num += 1
            time.sleep(1)  # Be polite and don't hammer the server
            
        except requests.RequestException as e:
            print(f"Error fetching page {page_num}: {e}")
            break
    
    print(f"\nFound {len(all_event_links)} matching events. Fetching details...")
    
    # Now visit each event page to get full details
    events = []
    for i, event_link in enumerate(all_event_links, 1):
        print(f"Processing event {i}/{len(all_event_links)}: {event_link['title']}")
        
        datetime_str, location_name, description = extract_event_details(event_link['url'])
        
        # Get location coordinates
        location_data = get_location_coordinates(location_name)
        
        event = {
            'title': event_link['title'],
            'description': description or '',
            'datetime': datetime_str or '',
            'location': location_data['name'],
            'url': event_link['url'],
            'latitude': location_data['latitude'],
            'longitude': location_data['longitude']
        }
        
        events.append(event)
        time.sleep(0.5)  # Be polite between requests
    
    return events

def upload_to_supabase(events, supabase_url, supabase_key, table='events_muswellbrook'):
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
    print("Scraping Muswellbrook Library events...")
    print("-" * 80)
    
    # Get Supabase credentials from environment variables
    supabase_url = os.environ.get('SUPABASE_URL')
    supabase_key = os.environ.get('SUPABASE_KEY')
    
    if not supabase_url or not supabase_key:
        print("Error: SUPABASE_URL and SUPABASE_KEY environment variables must be set")
        return
    
    # Scrape events
    events = scrape_muswellbrook_library_events()
    
    if events:
        print(f"\n{'='*80}")
        print(f"Found {len(events)} family/children events\n")
        
        # Upload to Supabase
        upload_to_supabase(events, supabase_url, supabase_key)
    else:
        print("No matching events found.")

if __name__ == "__main__":
    main()
