import requests
import json
import os
from datetime import datetime

# Venue mapping with coordinates
VENUE_COORDINATES = {
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
    def get_organizer_events(self, organizer_id, status='all', order_by='start_asc'):
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
                parsed_event['minimum_ticket_price'] = ticket_availability.get('minimum_ticket_price', {}).get('display')
                parsed_event['maximum_ticket_price'] = ticket_availability.get('maximum_ticket_price', {}).get('display')
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
    organizer_id_cessnock = "17689152323"  # Cessnock City Library organizer ID
    organizer_id_singleton = "72168255123" # Singleton City Library organizer ID
    
    api = EventbriteAPI(api_token)
    
    # Get all live events for both organizers
    events_cessnock = api.get_organizer_events(organizer_id_cessnock, status='live')
    events_singleton = api.get_organizer_events(organizer_id_singleton, status='live')
    
    # Combine lists
    all_events = events_cessnock + events_singleton
    
    # Filter out any events that have already ended
    now = datetime.now()
    future_events = [
        event for event in events
        if event.get('end_date') and datetime.fromisoformat(event['end_date']) > now
    ]
    
    return future_events

if __name__ == "__main__":
    events = main()
