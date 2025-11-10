import os
from fetch_cessnock import EventbriteAPI
from push_to_sb_cessnock import push_events_to_supabase

def main():
    # Configuration
    api_token = os.getenv("EVENTBRITE_API_TOKEN")
    organizer_id = "17689152323"  # Cessnock City Library
    table_name = "events_cessnock"
    
    if not api_token:
        print("✗ Error: EVENTBRITE_API_TOKEN environment variable not set")
        return False
    
    # Step 1: Fetch events from Eventbrite
    print(f"\n[1/2] Fetching events from Eventbrite...")
    print(f"      Organizer ID: {organizer_id}")
    
    api = EventbriteAPI(api_token)
    events = api.get_organizer_events(organizer_id, status='live')
    delete_past_events()  # Clean up database
    
    if not events:
        print("✗ No events found or error occurred")
        return False
    
    print(f"✓ Successfully fetched {len(events)} event(s)")
    
    # Optional: Print event summary
    print("\nEvent Summary:")
    for i, event in enumerate(events, 1):
        print(f"  {i}. {event.get('name')} - {event.get('start_date')}")
    
    # Step 2: Push to Supabase
    print(f"\n[2/2] Pushing events to Supabase...")
    success = push_events_to_supabase(events, table_name=table_name)
    
    if success:
        print("\n" + "=" * 80)
        print("✓ SUCCESS: All events synced to Supabase!")
        print("=" * 80)
        return True
    else:
        print("\n" + "=" * 80)
        print("✗ FAILED: Could not sync events to Supabase")
        print("=" * 80)
        return False

if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
