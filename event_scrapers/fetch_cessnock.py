import requests
import json
import os
from datetime import datetime

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
            if venue and isinstance(venue, dict):
                parsed_event['venue_name'] = venue.get('name')
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

    # Pretty print the flattened events
    def print_events(self, events):
        if not events:
            print("No events found.")
            return
        
        print(f"\nFound {len(events)} event(s):\n")
        print("=" * 80)
        
        for i, event in enumerate(events, 1):
            print(f"\nEvent #{i}")
            print(f"Event ID: {event.get('event_id')}")
            print(f"Name: {event.get('name')}")
            print(f"Status: {event.get('status')}")
            print(f"URL: {event.get('url')}")
            print(f"Start: {event.get('start_date')} ({event.get('start_timezone')})")
            print(f"End: {event.get('end_date')}")
            
            # Venue info (now flattened)
            if event.get('venue_name'):
                print(f"Venue: {event.get('venue_name')}")
                if event.get('venue_address'):
                    print(f"Address: {event.get('venue_address')}")
            
            # Ticket info (now flattened)
            if event.get('is_free'):
                print("Price: FREE")
            else:
                min_price = event.get('minimum_ticket_price')
                max_price = event.get('maximum_ticket_price')
                if min_price and max_price:
                    if min_price == max_price:
                        print(f"Price: {min_price}")
                    else:
                        print(f"Price: {min_price} - {max_price}")
                if event.get('is_sold_out'):
                    print("Status: SOLD OUT")
            
            print(f"Capacity: {event.get('capacity')}")
            print(f"Online Event: {'Yes' if event.get('online_event') else 'No'}")
            
            if event.get('description'):
                desc = event['description'][:200] + '...' if len(event['description']) > 200 else event['description']
                print(f"Description: {desc}")
            
            print("-" * 80)

    # Save flattened events to JSON file
    def save_to_json(self, events, filename='events_flat.json'):
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(events, f, indent=2, ensure_ascii=False)
        print(f"\nFlattened events saved to {filename}")


def main():
    # Use environment variable for API token (fallback to hardcoded for local testing)
    api_token = os.getenv("EVENTBRITE_API_TOKEN", "DGXGPZATKYMQPQCMIY62")
    organizer_id = "17689152323"  # Cessnock City Library organizer ID
    
    print(f"Fetching events for organizer ID: {organizer_id}")
    
    api = EventbriteAPI(api_token)
    
    # Get all live events - returns FLATTENED data ready for Supabase
    events = api.get_organizer_events(organizer_id, status='live')
    
    # Display results
    api.print_events(events)
    
    # Save to JSON (for debugging)
    #if events:
    #    api.save_to_json(events, 'cessnock_library_events_flat.json')
    
    return events


if __name__ == "__main__":
    events = main()
