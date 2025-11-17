from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException
from selenium.webdriver.chrome.options import Options
from supabase import create_client, Client
import time
import os
import re
from datetime import datetime, timedelta


class PlaygroupScraper:
    def __init__(self):
        self.events = []
    
    def parse_time_to_datetime(self, day_name, time_info):
        """
        Parse day and time information into a datetime object.
        Returns the next occurrence of that day/time.
        
        Args:
            day_name: e.g., "Tuesday" or "Lovedale Nature and Nurture Outdoor Art Tuesday"
            time_info: e.g., "Weekly (Tuesday) at 9:30 AM"
            
        Returns:
            datetime object or None if parsing fails
        """
        try:
            # Extract day of week from either field
            days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
            day_lower = day_name.lower()
            time_lower = time_info.lower()
            
            target_day = None
            for day in days:
                if day in day_lower or day in time_lower:
                    target_day = day
                    break
            
            if not target_day:
                return None
            
            # Extract time using regex
            time_match = re.search(r'(\d{1,2}):(\d{2})\s*(AM|PM)', time_info, re.IGNORECASE)
            if not time_match:
                return None
            
            hour = int(time_match.group(1))
            minute = int(time_match.group(2))
            period = time_match.group(3).upper()
            
            # Convert to 24-hour format
            if period == 'PM' and hour != 12:
                hour += 12
            elif period == 'AM' and hour == 12:
                hour = 0
            
            # Get current date and find next occurrence of target day
            today = datetime.now()
            current_day = today.strftime('%A').lower()
            
            # Map day names to numbers (Monday = 0, Sunday = 6)
            day_map = {day: i for i, day in enumerate(days)}
            current_day_num = day_map[current_day]
            target_day_num = day_map[target_day]
            
            # Calculate days until target day
            days_ahead = target_day_num - current_day_num
            if days_ahead < 0:  # Target day already happened this week
                days_ahead += 7
            elif days_ahead == 0:  # It's today
                # Check if the time has already passed
                event_time = today.replace(hour=hour, minute=minute, second=0, microsecond=0)
                if event_time < today:
                    days_ahead = 7  # Next week
            
            # Create the datetime
            next_occurrence = today + timedelta(days=days_ahead)
            next_occurrence = next_occurrence.replace(hour=hour, minute=minute, second=0, microsecond=0)
            
            return next_occurrence
            
        except Exception as e:
            print(f"Error parsing datetime: {e}")
            return None

    def scrape_playgroups(self, url):
        """
        Scrapes playgroup events from the given URL.
        
        Args:
            url: The playgroup search results URL
        """
        # Set up Chrome driver for GitHub Actions
        options = Options()
        options.add_argument('--headless')
        options.add_argument('--no-sandbox')
        options.add_argument('--disable-dev-shm-usage')
        options.add_argument('--disable-gpu')
        options.add_argument('--window-size=1920,1080')
        
        driver = webdriver.Chrome(options=options)
        
        try:
            print(f"Loading URL: {url}")
            driver.get(url)
            
            # Wait for initial results to load
            wait = WebDriverWait(driver, 10)
            wait.until(EC.presence_of_element_located((By.CLASS_NAME, "playgroup-filter__results-list-item")))
            
            # Click "Load More" button until no more results
            while True:
                try:
                    # Wait a bit for content to load
                    time.sleep(2)
                    
                    # Try to find and click the "Load More" button
                    load_more_btn = driver.find_element(By.ID, "playgroup-filter__results-list-loadmore-btn")
                    
                    # Check if button is visible and enabled
                    if load_more_btn.is_displayed() and load_more_btn.is_enabled():
                        print("Clicking 'Load More' button...")
                        driver.execute_script("arguments[0].click();", load_more_btn)
                        time.sleep(2)  # Wait for new content to load
                    else:
                        print("'Load More' button not clickable, finished loading.")
                        break
                        
                except NoSuchElementException:
                    print("No more 'Load More' button found. All results loaded.")
                    break
                except Exception as e:
                    print(f"Error clicking 'Load More': {e}")
                    break
            
            # Now scrape all the events
            print("Scraping events...")
            event_elements = driver.find_elements(By.CLASS_NAME, "playgroup-filter__results-list-item")
            print(f"Found {len(event_elements)} events")
            
            for event_elem in event_elements:
                try:
                    # Get event name and URL
                    title_link = event_elem.find_element(By.CSS_SELECTOR, "h2.card-title a")
                    event_name = title_link.text.strip()  + " Playgroup"
                    event_url = title_link.get_attribute('href')
                    
                    # Get location and coordinates
                    try:
                        address_elem = event_elem.find_element(By.TAG_NAME, "address")
                        # Get the text before the <br> tag (first line of address)
                        location_text = address_elem.text.split('\n')[0].strip()
                        
                        # Extract coordinates from Google Maps link
                        try:
                            maps_link = address_elem.find_element(By.CSS_SELECTOR, "a[href*='google.com/maps']")
                            maps_url = maps_link.get_attribute('href')
                            # Extract lat,long from URL like: destination=-33.1360212,151.5840258
                            latitude = None
                            longitude = None
                            if 'destination=' in maps_url:
                                coords = maps_url.split('destination=')[1].split('&')[0]
                                lat, lon = coords.split(',')
                                latitude = float(lat)
                                longitude = float(lon)
                        except (NoSuchElementException, ValueError, IndexError):
                            latitude = None
                            longitude = None
                            
                    except NoSuchElementException:
                        location_text = 'N/A'
                        latitude = None
                        longitude = None
                    
                    # Get time/day information from series-list
                    series_list = event_elem.find_elements(By.CSS_SELECTOR, ".series-list > div")
                    
                    if series_list:
                        # Multiple time slots
                        for series in series_list:
                            try:
                                day_name = series.find_element(By.TAG_NAME, "strong").text.strip()
                                time_info = series.find_element(By.CSS_SELECTOR, ".bg-primary div").text.strip()
                                
                                # Parse datetime
                                event_datetime = self.parse_time_to_datetime(day_name, time_info)
                                
                                self.events.append({
                                    'name': event_name,
                                    'date_readable': time_info,
                                    'datetime': event_datetime.isoformat() if event_datetime else None,
                                    'location': location_text,
                                    'url': event_url,
                                    'latitude': latitude,
                                    'longitude': longitude
                                })
                            except NoSuchElementException:
                                continue
                    else:
                        # No specific time info
                        self.events.append({
                            'name': event_name,
                            'date_readable': 'N/A',
                            'datetime': None,
                            'location': location_text,
                            'url': event_url,
                            'latitude': latitude,
                            'longitude': longitude
                        })
                        
                except Exception as e:
                    print(f"Error scraping event: {e}")
                    continue
            
        finally:
            driver.quit()
        
        print(f"Successfully scraped {len(self.events)} events")

    def upload_to_supabase(self, supabase_url, supabase_key, table='playgroups_nsw'):
        """Upload events to Supabase"""
        if not self.events:
            print("No events to upload.")
            return
        
        try:
            supabase: Client = create_client(supabase_url, supabase_key)
            
            # Map to Supabase table columns
            columns = ['name', 'date_readable', 'datetime', 'location', 'url', 'latitude', 'longitude']
            clean = [{k: e.get(k) for k in columns} for e in self.events if 'error' not in e]
            
            # Delete existing records and insert new ones
            print(f"Clearing existing records from {table}...")
            supabase.table(table).delete().neq('name', '').execute()
            
            print(f"Inserting {len(clean)} new records...")
            supabase.table(table).insert(clean).execute()
            
            print(f"✅ Successfully uploaded {len(clean)} records to {table}")
            
        except Exception as e:
            print(f"❌ Error uploading to Supabase: {e}")
            raise


def main():
    # Get environment variables
    supabase_url = os.getenv('SUPABASE_URL')
    supabase_key = os.getenv('SUPABASE_KEY')
    
    if not supabase_url or not supabase_key:
        raise ValueError("SUPABASE_URL and SUPABASE_KEY environment variables must be set")
    
    # Define search URL
    url = "https://www.playgroupnsw.org.au/playgroups/find-a-playgroup/?search=LOSTOCK+2311&radius=100"
    
    # Create scraper instance
    scraper = PlaygroupScraper()
    
    # Scrape the playgroups
    print("Starting scraper...")
    scraper.scrape_playgroups(url)
    
    # Upload to Supabase
    print("\nUploading to Supabase...")
    scraper.upload_to_supabase(supabase_url, supabase_key)
    
    print("\n✅ Script completed successfully!")


if __name__ == "__main__":
    main()
