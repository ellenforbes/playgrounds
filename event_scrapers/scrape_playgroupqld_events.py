from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException
from datetime import datetime
from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderServiceError
from supabase import create_client, Client
import time
import re
import os

class PlayMattersScraper:
    def __init__(self, base_url):
        self.base_url = base_url
        self.driver = None
        self.events = []
        self.geolocator = Nominatim(user_agent="playmatters_scraper")
        self.geocode_cache = {}
        
        # Coordinate lookup table from your data
        self.coordinate_lookup = {
            "1 Jones Road\nBirkdale, QLD 4159": (-27.514434, 153.2029941),
            "1/3 Azalea St\nInala, QLD 4077": (-27.5889619, 152.976249),
            "10 Jubilee Terrace\nAshgrove, QLD 4060": (-27.4464783, 152.9897408),
            "10 Stephen St\nCamp Hill, QLD 4152": (-27.4877236, 153.0736089),
            "100 Mayfield Rd\nCARINA, QLD 4152": (-27.4920223, 153.0900431),
            "101 Birkdale Road\nBirkdale, QLD 4159": (-27.4960136, 153.2132037),
            "12 Burilda Street\nHendra, QLD 4011": (-27.4205269, 153.0681134),
            "12 Emerald Street\nKedron, QLD 4031": (-27.4084414, 153.0336544),
            "12/59 Brisbane Rd\nRedbank, QLD 4301": (-27.6001662, 152.8749153),
            "121 Barbaralla Drive\nSpringwood, QLD 4127": (-27.6295354, 153.1338083),
            "12-54 Goodna Road\nGreenbank, QLD 4124": (-27.7044234, 152.9714218),
            "134 Brighton Road\nSandgate, QLD 4017": (-27.3182441, 153.0680564),
            "138 Old Ipswich Rd\nRiverview, QLD 4303": (-27.6030319, 152.848441),
            "1413 Creek Road\nCarindale, QLD 4152": (-27.4932843, 153.1027505),
            "145 Florence Steet\nWynnum, QLD 4178": (-27.4446132, 153.1710948),
            "1523 Beenleigh Rd\nKuraby, QLD 4112": (-27.6076261, 153.0963636),
            "17 Hawtree Street\nMoorooka, QLD 4105": (-27.5377293, 153.0188511),
            "20 Kurts Street\nHolland Park West, QLD 4121": (-27.5258015, 153.0584966),
            "201 Bracken Street\nBracken Ridge, QLD 4017": (-27.3130472, 153.0394785),
            "2036 Wynnum Road\nWynnum West, QLD 4178": (-27.4539523, 153.1554656),
            "21 Nathan Road\nRuncorn, QLD 4113": (-27.5912983, 153.069391),
            "2131 Gympie Rd\nBald hills, QLD 4036": (-27.3216095, 153.0092701),
            "233 Kitchener Road\nStafford Heights, QLD 4053": (-27.3965072, 153.0187467),
            "24 Pope Street\nTarragindi, QLD 4121": (-27.5290605, 153.0443473),
            "240 Hamilton Rd\nChermside, QLD 4032": (-27.3880962, 153.0432259),
            "247 Simpson Rd\nBardon, QLD 4065": (-27.4591988, 152.976605),
            "25 Bowman St\nHendra, QLD 4011": (-27.4212887, 153.0665447),
            "25 Lytton Rd\nBulimba, QLD 4171": (-27.4511921, 153.0639279),
            "25 Main Avenue\nBalmoral, QLD 4171": (-27.4586492, 153.0676179),
            "26 Arrowsmith Street\nCamp Hill, QLD 4152": (-27.4890654, 153.0854166),
            "27 Macfarlane Street\nMiddle Park, QLD 4074": (-27.5601345, 152.9185536),
            "27-61 Augusta Street\nCrestmead, QLD 4132": (-27.6882158, 153.0856424),
            "31 Helena Street\nAspley, QLD 4034": (-27.3624058, 153.0233952),
            "31 York Street\nIndooroopilly, QLD 4068": (-27.4955306, 152.9772288),
            "34 Esher St\nTarragindi, QLD 4121": (-27.5193517, 153.0493095),
            "341 Broadwater Road\nMansfield, QLD 4122": (-27.5461505, 153.0971883),
            "343 Cavendish Road\nCoorparoo, QLD 4151": (-27.5048929, 153.0611177),
            "4 Clewley Street\nCorinda, QLD 4075": (-27.5382472, 152.9833613),
            "4 Progress St\nSamford Valley, QLD 4520": (-27.3720898, 152.8871406),
            "4/46 Charlotte Street, Brisbane\nBrisbane CBD, QLD 4000": (-27.4715862, 153.0255969),
            "40 Gainsborough St\nMoorooka, QLD 4105": (-27.535575, 153.0208479),
            "40 Ruby Rd\nMitchelton, QLD 4053": (-27.4095101, 152.97385),
            "42 Dayboro Road\nPetrie, QLD 4502": (-27.2674664, 152.9735548),
            "43 Glass House Circuit\nKallangur, QLD 4503": (-27.2396431, 152.9903087),
            "43 Macfarlane St\nMiddle Park, QLD 4073": (-27.5583144, 152.9176472),
            "501 Hamilton Rd\nChermside, QLD 4032": (-27.3851608, 153.0281283),
            "545 Roghan Rd\nFitzgibbon, QLD 4018": (-27.3387599, 153.0280996),
            "55 Cinderella Drive\nSpringwood, QLD 4127": (-27.614657, 153.131937),
            "56 Barlow Street\nClayfield, QLD 4007": (-27.4285293, 153.0539589),
            "58 Maygar Street\nWindsor, QLD 4030": (-27.4267778, 153.0317879),
            "60 Preston Rd\nManly West, QLD 4179": (-27.4566698, 153.1745383),
            "60 Preston Road\nManly West, QLD 4179": (-27.4566698, 153.1745383),
            "663 Lutwyche Rd Lutwyche 4030\nWooloowin, QLD 4030": (-27.4178675, 153.0360023),
            "67 Dawson Parade\nKeperra, QLD 4054": (-27.4082489, 152.9625876),
            "68 Orange Grove Road\nCoopers Plains, QLD 4108": (-27.5665123, 153.0382177),
            "69 Inala Ave\nDurack, QLD 4077": (-27.5938403, 152.9916197),
            "71 Newnham Rd\nMount Gravatt East, QLD 4122": (-27.5357809, 153.0927444),
            "71 Oxford Street\nHamilton, QLD 4007": (-27.433099, 153.0738635),
            "73 Everest Street\nSunnybank, QLD 4109": (-27.5769492, 153.050819),
            "74 Station Road\nIndooroopilly, QLD 4068": (-27.5027816, 152.975503),
            "77 Bracken street\nBracken Ridge, QLD 4017": (-27.3182213, 153.0378282),
            "79 Poinsettia Street\nInala, QLD 4077": (-27.5980364, 152.9655454),
            "79 Waratah Ave\nGraceville, QLD 4075": (-27.5180746, 152.9827937),
            "82 Sherwood Rd\nToowong, QLD 4066": (-27.4856973, 152.9887143),
            "83 Alpita Street\nKuraby, QLD 4112": (-27.6063269, 153.0911118),
            "86 Orchid Street\nEnoggera, QLD 4051": (-27.4158296, 152.9939524),
            "92 Laurel St\nEnoggera, QLD 4051": (-27.4169499, 152.993257),
            "929 Oxley Road\nOxley, QLD 4075": (-27.5517685, 152.9787353),
            "95 Redwood Street\nStafford Heights, QLD 4053": (-27.4009517, 153.003957),
            "Cnr Park Rd & Villa St\nYeronga, QLD 4104": (-27.5170722, 153.020243),
            "Cultural Precinct, Stanley Pl\nSouth Brisbane, QLD 4101": (-27.4721901, 153.017426),
            "Cultural Precinct, Stanley Place\nBrisbane, QLD 4101": (-27.4721901, 153.017426),
            "Danzy Buchanan Park, Chermside Rd\nMango Hill, QLD 4509": (-27.2186365, 153.0294121),
            "for location\nPaddington, QLD 4064": (-27.4615764, 153.010358),
            "Gooderham Road and Brookbent Road\nPallara, QLD 4110": (-27.6091385, 153.0104313),
            "Kauri Place\nForest Lake, QLD 4078": (-27.6138292, 152.9586564),
            "Keong Road\nAlbany Creek, QLD 4035": (-27.3545484, 152.9760432),
            "Lamorna St\nRochedale South, QLD 4123": (-27.5903809, 153.1275561),
            "Lillian Avenue\nSalisbury, QLD 4107": (-27.5555385, 153.0384154),
            "Memorial Drive\nNorth Lakes, QLD 4509": (-27.2321335, 153.027331),
            "New Farm Community Centre\nNew Farm, QLD 4005": (-27.4696897, 153.0488461),
            "Olive Garden Early Learning 724 Blunder Road\nDurack, QLD 4077": (-27.5974779, 152.9888714),
            "Redland Integrated Early Years Place, Cnr School Rd and Mount Cotton Rd\nCapalaba, QLD 4157": (-27.5348312, 153.1901934),
            "Redlands Integrated Early Years Place, Cnr School Rd and Mount Cotton Rd\nCapalaba, QLD 4157": (-27.5348312, 153.1901934),
            "shop 12 / 59 Brisbane Rd\nRedbank, QLD 4301": (-27.6010291, 152.8693411),
            "Shop 12, 59 Brisbane Road\nRedbank, QLD 4301": (-27.6010291, 152.8693411),
            "Shop 12, 59 Brisbane Road,\nRedbank, QLD 4301": (-27.6010291, 152.8693411),
            "Shop 12, 59 Brisbane road\nRedbank, QLD 4301": (-27.6010291, 152.8693411),
            "Stanley Place\nBrisbane, QLD 4101": (-27.4721901, 153.017426),
            "Cnr Brookfield Rd and Boscombe Street,\nBrookfield, QLD 4069": (-27.4932037, 152.9142048),
            "Cnr Logan and Kessels Road\nUpper Mount Gravatt, QLD 4122": (-27.5597145, 153.0805483),
        }
        
    def setup_driver(self):
        """Initialize the Chrome WebDriver"""
        options = webdriver.ChromeOptions()
        options.add_argument('--headless')
        options.add_argument('--no-sandbox')
        options.add_argument('--disable-dev-shm-usage')
        self.driver = webdriver.Chrome(options=options)
        self.driver.implicitly_wait(10)
        
    def parse_datetime(self, datetime_readable):
        """Convert datetime_readable string to datetime object
        Example input: '9 December,   at 10:15am Tuesday'
        Returns datetime object in format suitable for TIMESTAMPTZ
        """
        try:
            if not datetime_readable:
                return None
            
            parts = re.split(r',\s*at\s*', datetime_readable, flags=re.IGNORECASE)
            
            if len(parts) < 2:
                print(f"  Could not split datetime: {datetime_readable}")
                return None
            
            date_part = parts[0].strip()
            time_part = parts[1].strip()
            
            # Extract 24-hour time: HH:MM
            time_match = re.search(r'\b(\d{1,2}:\d{2})\b', time_part)
            if not time_match:
                print(f"  Could not extract time from: {time_part}")
                return None
            
            time_str = time_match.group(1)  # Already 24-hour style (Play Matters uses thi
            
            date_match = re.match(r'(\d{1,2})\s+(\w+)', date_part)
            if not date_match:
                print(f"  Could not parse date: {date_part}")
                return None
            
            day = int(date_match.group(1))
            month_str = date_match.group(2)
            
            now = datetime.now()
            current_year = now.year
            
            month_num = datetime.strptime(month_str, '%B').month
            
            year = current_year
            temp_date = datetime(year, month_num, day)
            if temp_date.date() < now.date():
                year += 1
            
            dt = datetime.strptime(f"{day} {month_str} {year} {time_str}",'%d %B %Y %H:%M')
            return dt
        except Exception as e:
            print(f"  Error parsing datetime: {e}")
            print(f"  Input: '{datetime_readable}'")
            return None
    
    def clean_address(self, address):
        """Clean and normalize address for lookup"""
        if not address:
            return ""
        cleaned = '\n'.join(line.strip() for line in address.split('\n') if line.strip())
        return cleaned
    
    def lookup_coordinates(self, address):
        """Check if address exists in lookup table"""
        cleaned_address = self.clean_address(address)
        if cleaned_address in self.coordinate_lookup:
            return self.coordinate_lookup[cleaned_address]
        return None, None
    
    def geocode_address(self, address):
        """Get latitude and longitude from address using geocoding"""
        if address in self.geocode_cache:
            return self.geocode_cache[address]
        
        try:
            address_clean = address.replace('\n', ', ')
            
            for attempt in range(3):
                try:
                    location = self.geolocator.geocode(address_clean, timeout=10)
                    if location:
                        lat, lng = location.latitude, location.longitude
                        self.geocode_cache[address] = (lat, lng)
                        time.sleep(1)
                        return lat, lng
                    break
                except GeocoderTimedOut:
                    if attempt < 2:
                        time.sleep(2)
                        continue
                    break
        except (GeocoderServiceError, Exception) as e:
            print(f"  Geocoding error: {e}")
        
        self.geocode_cache[address] = (None, None)
        return None, None
    
    def extract_lat_long_from_page(self):
        """Extract latitude and longitude from current page source"""
        try:
            page_source = self.driver.page_source
            
            if 'google.com/maps' in page_source:
                maps_match = re.search(r'center=([-]?\d+\.\d+)%2C([-]?\d+\.\d+)', page_source)
                if maps_match:
                    return float(maps_match.group(1)), float(maps_match.group(2))
            
            lat_match = re.search(r'["\']lat["\']?\s*:\s*([-]?\d+\.\d+)', page_source, re.IGNORECASE)
            lng_match = re.search(r'["\']lng["\']?\s*:\s*([-]?\d+\.\d+)', page_source, re.IGNORECASE)
            
            if lat_match and lng_match:
                return float(lat_match.group(1)), float(lng_match.group(1))
            
            lon_match = re.search(r'["\']lon(?:gitude)?["\']?\s*:\s*([-]?\d+\.\d+)', page_source, re.IGNORECASE)
            if lat_match and lon_match:
                return float(lat_match.group(1)), float(lon_match.group(1))
            
            return None, None
        except Exception as e:
            print(f"Error extracting coordinates: {e}")
            return None, None
    
    def scrape_page(self):
        """Scrape all events from the current page"""
        try:
            WebDriverWait(self.driver, 10).until(
                EC.presence_of_element_located((By.CLASS_NAME, "b-card"))
            )
            
            time.sleep(2)
            
            event_items = self.driver.find_elements(By.CSS_SELECTOR, "li.false")
            
            print(f"Found {len(event_items)} event items")
            
            for idx, item in enumerate(event_items):
                try:
                    event_data = {}
                    
                    try:
                        name_link = item.find_element(By.CSS_SELECTOR, "h3 a, h3[role='heading'] a")
                        event_data['name'] = name_link.text.strip()
                        event_data['url'] = name_link.get_attribute('href')
                    except NoSuchElementException:
                        print(f"Event {idx}: Could not find name/URL")
                        continue
                    
                    try:
                        desc = item.find_element(By.CSS_SELECTOR, "div.l-module p")
                        event_data['description'] = desc.text.strip()
                    except NoSuchElementException:
                        event_data['description'] = ""
                    
                    try:
                        location_elem = item.find_element(By.CLASS_NAME, "e-pg__where")
                        location_text = location_elem.text.strip()
                        location_lines = [line.strip() for line in location_text.split('\n') if line.strip()]
                        location_lines = [line for line in location_lines if 'km away' not in line.lower()]
                        
                        if len(location_lines) > 1:
                            location_lines = [line for line in location_lines if line != 'Brisbane, QLD 4000']
                        
                        if len(location_lines) > 1:
                            location_lines = location_lines[1:]
                        
                        event_data['location'] = '\n'.join(location_lines)
                    except NoSuchElementException:
                        event_data['location'] = ""
                    
                    try:
                        date_section = item.find_element(By.CSS_SELECTOR, "div.span3.h-txt__bold")
                        date_text = date_section.text.strip()
                        lines = [line.strip() for line in date_text.split('\n') if line.strip() and 'View group' not in line]
                        
                        if len(lines) >= 2:
                            time_and_day = lines[0]
                            date_and_month = lines[1]
                            
                            datetime_str = f"{date_and_month},  at {time_and_day}"
                            event_data['datetime_readable'] = datetime_str
                            
                            dt = self.parse_datetime(datetime_str)
                            if dt:
                                # Store as ISO format datetime for TIMESTAMPTZ
                                event_data['datetime_stamp'] = dt.isoformat()
                            else:
                                event_data['datetime_stamp'] = None
                        else:
                            print(f"  Unexpected date format - lines: {lines}")
                            event_data['datetime_readable'] = date_text
                            event_data['datetime_stamp'] = None
                        
                    except (NoSuchElementException, IndexError) as e:
                        print(f"  Error extracting date/time: {e}")
                        event_data['datetime_readable'] = ""
                        event_data['datetime_stamp'] = None
                    
                    print(f"Event {idx + 1}: {event_data['name']}")
                    
                    lat, lng = None, None
                    
                    if event_data['location']:
                        lat, lng = self.lookup_coordinates(event_data['location'])
                        if lat:
                            print(f"  ✓ Found in lookup table")
                    
                    if lat is None:
                        try:
                            self.driver.execute_script("window.open(arguments[0], '_blank');", event_data['url'])
                            self.driver.switch_to.window(self.driver.window_handles[-1])
                            time.sleep(2)
                            
                            lat, lng = self.extract_lat_long_from_page()
                            
                            self.driver.close()
                            self.driver.switch_to.window(self.driver.window_handles[0])
                        except Exception as e:
                            print(f"  Error getting coords from detail page: {e}")
                            if len(self.driver.window_handles) > 1:
                                self.driver.close()
                                self.driver.switch_to.window(self.driver.window_handles[0])
                    
                    if lat is None and event_data['location']:
                        print(f"  Geocoding address...")
                        lat, lng = self.geocode_address(event_data['location'])
                    
                    event_data['latitude'] = lat
                    event_data['longitude'] = lng
                    
                    self.events.append(event_data)
                    coord_str = f"lat: {lat}, lng: {lng}" if lat else "coords not found"
                    print(f"  ✓ Scraped successfully ({coord_str})")
                    
                except Exception as e:
                    print(f"Error scraping event {idx}: {e}")
                    if len(self.driver.window_handles) > 1:
                        self.driver.close()
                        self.driver.switch_to.window(self.driver.window_handles[0])
                    continue
                    
        except TimeoutException:
            print("Timeout waiting for page to load")
    
    def click_pagination(self, page_num):
        """Click on pagination button for given page number"""
        try:
            time.sleep(2)
            
            pagination_link = WebDriverWait(self.driver, 10).until(
                EC.element_to_be_clickable((By.CSS_SELECTOR, f"a.e-pagi-link[data-page='{page_num}']"))
            )
            
            self.driver.execute_script("arguments[0].scrollIntoView(true);", pagination_link)
            time.sleep(1)
            
            self.driver.execute_script("arguments[0].click();", pagination_link)
            
            time.sleep(3)
            return True
            
        except Exception as e:
            print(f"Error clicking pagination for page {page_num + 1}: {e}")
            return False
    
    def scrape_all_pages(self, max_pages=10):
        """Scrape events from pages 1 to max_pages"""
        self.setup_driver()
        
        try:
            print(f"Loading initial URL: {self.base_url}")
            self.driver.get(self.base_url)
            time.sleep(3)
            
            print("\n=== Scraping page 1 ===")
            self.scrape_page()
            
            for page_num in range(1, min(max_pages, 10)):
                print(f"\n=== Navigating to page {page_num + 1} ===")
                if self.click_pagination(page_num):
                    print(f"=== Scraping page {page_num + 1} ===")
                    self.scrape_page()
                else:
                    print(f"Failed to navigate to page {page_num + 1}")
                    break
            
        finally:
            self.driver.quit()
    
    def upload_to_supabase(self, supabase_url, supabase_key, table='playgroups_qld'):
        """Upload events to Supabase"""
        if not self.events:
            print("No events to upload.")
            return
        
        try:
            supabase: Client = create_client(supabase_url, supabase_key)
            
            # Map to Supabase table columns
            columns = ['name', 'datetime_readable', 'datetime_stamp', 'location', 'url', 'description', 'latitude', 'longitude']
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


if __name__ == "__main__":
    base_url = "https://playmatters.org.au/search?p=4000&s=QLD&ltln=-27.4587,153.0222"
    
    # Get Supabase credentials from environment variables
    supabase_url = os.getenv('SUPABASE_URL')
    supabase_key = os.getenv('SUPABASE_KEY')
    
    if not supabase_url or not supabase_key:
        raise ValueError("SUPABASE_URL and SUPABASE_KEY environment variables must be set")
    
    scraper = PlayMattersScraper(base_url)
    scraper.scrape_all_pages(max_pages=10)
    
    # Upload to Supabase instead of saving to CSV
    scraper.upload_to_supabase(supabase_url, supabase_key, table='playgroups_qld')
    
    # Print summary
    print(f"\nTotal events scraped: {len(scraper.events)}")
    if scraper.events:
        print("\nFirst event sample:")
        for key, value in scraper.events[0].items():
            print(f"  {key}: {value}")
