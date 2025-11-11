import requests
import json
import os
from datetime import datetime

# Venue mapping with coordinates
VENUE_COORDINATES = {
    'Museum of Art and Culture Lake Macquarie': {
        'latitude': -32.97452,
        'longitude': 151.613024
    },
    'Windale Hub, bilyabayi': {
        'latitude': -32.9933567,
        'longitude': 151.6789841
    },
    'The Place Charlestown Community Centre': {
        'latitude': -32.9657058,
        'longitude': 151.6914588
    },
    'Sugar Valley Library Museum, kirantakamyari': {
        'latitude': -32.9161777,
        'longitude': 151.5959919
    },
    'Living Museum of Logan': {
        'latitude': -27.6580015,
        'longitude': 153.1177533
    },
    'Landcare and Sustainable Living Centre, umali barai-ku': {
        'latitude': -32.9682806,
        'longitude': 151.6033979
    },
    'Broadbeach Library': {
        'latitude': -28.0358658,
        'longitude': 153.4213373
    },
    'Museum of Brisbane': {
        'latitude': -27.4686749,
        'longitude': 153.0212528
    },
    'Museum of Art and Culture yapang, Lake Macquarie': {
        'latitude': -32.97452,
        'longitude': 151.613024
    },
    'Speers Point Library': {
        'latitude': -32.9598535,
        'longitude': 151.6199961
    },
    'Warner Park Playground': {
        'latitude': -32.9731964,
        'longitude': 151.6411558
    },
    'Tomaree Library & Community Centre': {
        'latitude': -32.7367741,
        'longitude': 152.1029423
    },
    'Raymond Terrace Library': {
        'latitude': -32.7617688,
        'longitude': 151.744583
    },
    'Toronto Library, tirrabiyangba': {
        'latitude': -33.0145906,
        'longitude': 151.5962564
    },
    'Newcastle Birth Movement': {
        'latitude': -32.9667339,
        'longitude': 151.6545833
    },
    "Let's Dilly Dally": {
        'latitude': -26.6247905,
        'longitude': 152.9591452
    },
    'Multi-Arts Pavilion (MAP mima) Lake Macquarie': {
        'latitude': -32.9610886,
        'longitude': 151.6148656
    },
    'Charlestown Library, walyamayi': {
        'latitude': -32.9626933,
        'longitude': 151.6969899
    },
    '253 Lang St': {
        'latitude': -32.819662,
        'longitude': 151.479111
    },
    'Cessnock City Library': {
        'latitude': -32.833889,
        'longitude': 151.356387
    },
    'Kurri Kurri Library': {
        'latitude': -32.819662,
        'longitude': 151.479111
    },
    'Cessnock Library': {
        'latitude': -32.833889,
        'longitude': 151.356387
    },
    'Singleton Public Library': {
        'latitude': -32.5586082,
        'longitude': 151.1749447
    }
}

# Family-friendly event keywords (case insensitive)
FAMILY_KEYWORDS = [
    'family',
    'toddler',
    'babies',
    'baby',
    'bubs',
    'bubba',
    'mummabubba',
    'kids',
    'teen',
    'art starter',
    'art play',
    'art explorers',
    'storytime',
    'rhymetime',
    'dungeons',
    'lego',
    'code',
    'stem',
    'steam',
    'children',
    'school holiday',
    'playgroup',
    'rock',
    'rhyme',
    'story stomp'
]

# All organizer IDs to fetch events from
ORGANIZER_IDS = [
    "17689152323",   # Cessnock City Library
    "72168255123",   # Singleton City Library
    "7802857319",    # Lake Mac Arts and Culture
    "32507525885",   # MidCoast Libraries and Culture
    "6309828769",    # Queensland Gallery of Modern Art (QAGOMA)
    "82549136163",   # LoganARTS
    "1347354923",    # State Library of Queensland
    "65102065633",   # Gold Coast Libraries
    "6212723759",    # Museum of Brisbane
    "67471959573",   # Stacey Rodda Annerly
    "104725898391",  # Living Museum of Logan
    "109001559971",  # Lets Dilly Dally Nambour
    "107190148231",  # Port Stephens Libraries
    "55557266483",   # Children and Family Planner Lake Mac
    "74588539343"    # Newcastle Birth Movement
]

# Initialize Eventbrite API client
class EventbriteAPI:
    def __init__(self, api_token):
        self.api_token = api_token
        self.base_url = "https://www.eventbriteapi.com/v3"
        self.headers = {
            'Authorization': f'Bearer {api_token}',
            'Content-Type': 'application/json'
        }

    # Get all events for a specific organizer
    def get_organizer_events(self, organizer_id, status='all', order_by='start_asc', filter_keywords=None):
        url = f"{self.base_url}/organizers/{organizer_id}/events/"
        params = { 'status': status, 'order_by': order_by, 'expand': 'venue,ticket_availability'}
        all_events = []
        page = 1
        
        try:
            while True:
                params['page'] = page
                response = requests.get(url, headers=self.headers, params=params)
                response.raise_for_status()
                
                data = response.json()
                events = data.get('events', [])
                
                if not events:
                    break
                
                all_events.extend(events)
                
                # Check if there are more pages
                pagination = data.get('pagination', {})
                if not pagination.get('has_more_items', False):
                    break
                
                page += 1
            
            # Filter BEFORE parsing if keywords provided
            if filter_keywords:
                all_events = self._filter_by_keywords(all_events, filter_keywords)
            
            return self._parse_events_flat(all_events)
            
        except requests.exceptions.HTTPError as e:
            if response.status_code == 401:
                print("Error: Invalid API token. Please check your token.")
            elif response.status_code == 404:
                print(f"Error: Organizer ID {organizer_id} not found.")
            else:
                print(f"HTTP Error: {e}")
            return []
        except requests.RequestException as e:
            print(f"Error fetching events: {e}")
            return []
    
    # Filter raw events by keywords BEFORE parsing
    def _filter_by_keywords(self, raw_events, keywords):
        filtered = []
        for event in raw_events:
            name = event.get('name', {}).get('text', '')
            description = event.get('description', {}).get('text', '')
            search_text = (name + " " + description).lower()
            
            # Check if any keyword matches
            if any(keyword.lower() in search_text for keyword in keywords):
                filtered.append(event)
        
        return filtered

    # Parse raw API events into FLATTENED format for Supabase
    def _parse_events_flat(self, raw_events):
        parsed_events = []
        
        for event in raw_events:
            # Start with basic event fields
            parsed_event = {
                'event_id': event.get('id'),
                'name': event.get('name', {}).get('text'),
                'description': event.get('description', {}).get('text'),
                'url': event.get('url'),
                'start_date': event.get('start', {}).get('local'),
                'start_timezone': event.get('start', {}).get('timezone'),
                'end_date': event.get('end', {}).get('local'),
                'end_timezone': event.get('end', {}).get('timezone'),
                'created': event.get('created'),
                'changed': event.get('changed'),
                'status': event.get('status'),
                'currency': event.get('currency', 'AUD'),
                'online_event': event.get('online_event', False),
                'capacity': event.get('capacity'),
                'is_free': event.get('is_free', False)
            }
            
            # Flatten venue information
            venue = event.get('venue')
            venue_name = None
            
            if venue and isinstance(venue, dict):
                venue_name = venue.get('name')
                parsed_event['venue_name'] = venue_name
                parsed_event['venue_address'] = venue.get('address', {}).get('localized_address_display')
                parsed_event['venue_city'] = venue.get('address', {}).get('city')
                parsed_event['venue_region'] = venue.get('address', {}).get('region')
                parsed_event['venue_postal_code'] = venue.get('address', {}).get('postal_code')
            else:
                parsed_event['venue_name'] = 'Online Event' if parsed_event['online_event'] else None
                parsed_event['venue_address'] = None
                parsed_event['venue_city'] = None
                parsed_event['venue_region'] = None
                parsed_event['venue_postal_code'] = None
            
            # Add latitude and longitude from mapping
            if venue_name and venue_name in VENUE_COORDINATES:
                coords = VENUE_COORDINATES[venue_name]
                parsed_event['latitude'] = coords['latitude']
                parsed_event['longitude'] = coords['longitude']
            else:
                parsed_event['latitude'] = None
                parsed_event['longitude'] = None
            
            # Flatten ticket availability
            ticket_availability = event.get('ticket_availability')
            if ticket_availability:
                parsed_event['has_available_tickets'] = ticket_availability.get('has_available_tickets', False)
                
                # Safely get ticket prices (they might be None)
                min_price = ticket_availability.get('minimum_ticket_price')
                parsed_event['minimum_ticket_price'] = min_price.get('display') if min_price else None
                
                max_price = ticket_availability.get('maximum_ticket_price')
                parsed_event['maximum_ticket_price'] = max_price.get('display') if max_price else None
                
                parsed_event['is_sold_out'] = ticket_availability.get('is_sold_out', False)
            else:
                parsed_event['has_available_tickets'] = None
                parsed_event['minimum_ticket_price'] = None
                parsed_event['maximum_ticket_price'] = None
                parsed_event['is_sold_out'] = None
            
            parsed_events.append(parsed_event)
        
        return parsed_events


def main():
    api_token = os.getenv("EVENTBRITE_API_TOKEN")
    api = EventbriteAPI(api_token)
    
    all_events = []
    
    # Get live events from all organizers with keyword filtering
    print(f"Fetching events from {len(ORGANIZER_IDS)} organizers...")
    for organizer_id in ORGANIZER_IDS:
        print(f"Fetching events for organizer {organizer_id}...")
        events = api.get_organizer_events(organizer_id, status='live', filter_keywords=FAMILY_KEYWORDS)
        all_events.extend(events)
        print(f"  Found {len(events)} family-friendly events")
    
    print(f"\nTotal family events fetched: {len(all_events)}")
    
    # Filter out any events that have already ended
    now = datetime.now()
    future_events = [
        event for event in all_events
        if event.get('end_date') and datetime.fromisoformat(event['end_date']) > now
    ]
    
    print(f"Future family events: {len(future_events)}")
    
    return future_events


if __name__ == "__main__":
    events = main()
