import os
from fetch_cessnock import EventbriteAPI, ORGANIZER_IDS, FAMILY_KEYWORDS
from push_to_sb_cessnock import push_events_to_supabase
from push_to_sb_cessnock import delete_past_events

def main():
    # Configuration
    api_token = os.getenv("EVENTBRITE_API_TOKEN")
    table_name = "events_cessnock"
    
    if not api_token:
        print("✗ Error: EVENTBRITE_API_TOKEN environment variable not set")
        return False
    
    # Step 1: Fetch events from Eventbrite
    print(f"\n[1/2] Fetching family-friendly events from Eventbrite...")
    print(f"      Organizers: {len(ORGANIZER_IDS)} total")
    print(f"      Keywords: {len(FAMILY_KEYWORDS)} filters applied")
    
    api = EventbriteAPI(api_token)
    all_events = []
    
    # Get live events from all organizers with keyword filtering
    for i, organizer_id in enumerate(ORGANIZER_IDS, 1):
        print(f"      [{i}/{len(ORGANIZER_IDS)}] Fetching organizer {organizer_id}...", end=' ')
        events = api.get_organizer_events(organizer_id, status='live', filter_keywords=FAMILY_KEYWORDS)
        all_events.extend(events)
        print(f"✓ {len(events)} family events")
    
    # Clean up past events from database
    delete_past_events()
    
    if not all_events:
        print("✗ No family-friendly events found or error occurred")
        return False
    
    print(f"\n✓ Successfully fetched {len(all_events)} family-friendly event(s)")
    
    # Optional: Print event summary
    print("\nEvent Summary:")
    for i, event in enumerate(all_events[:10], 1):  # Show first 10
        print(f"  {i}. {event.get('name')} - {event.get('start_date')}")
    
    if len(all_events) > 10:
        print(f"  ... and {len(all_events) - 10} more events")
    
    # Step 2: Push to Supabase
    print(f"\n[2/2] Pushing events to Supabase...")
    success = push_events_to_supabase(all_events, table_name=table_name)
    
    if success:
        print("\n" + "=" * 80)
        print("✓ SUCCESS: All events synced to Supabase!")
        print(f"  Total events: {len(all_events)}")
        print(f"  Organizers: {len(ORGANIZER_IDS)}")
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
