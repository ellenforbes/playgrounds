import os
from supabase import create_client, Client
from typing import List, Dict, Any
from datetime import datetime

# Initialize and return Supabase client
def get_supabase_client() -> Client:
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_KEY")
    
    if not supabase_url or not supabase_key:
        raise ValueError("SUPABASE_URL and SUPABASE_KEY environment variables must be set")
    
    return create_client(supabase_url, supabase_key)

# Push flattened event data to Supabase table
def push_events_to_supabase(events: List[Dict[str, Any]], table_name: str = "events_cessnock") -> bool:
    if not events:
        print("No events to push to Supabase.")
        return False
    
    try:
        supabase = get_supabase_client()
        
        print(f"Pushing {len(events)} event(s) to Supabase table '{table_name}'...")
        
        # Use upsert to avoid duplicates (based on event_id unique constraint)
        response = supabase.table(table_name).upsert(
            events,
            on_conflict="event_id"
        ).execute()
        
        print(f"✓ Successfully pushed {len(events)} event(s) to Supabase")
        print(f"  - Table: {table_name}")
        print(f"  - Records affected: {len(response.data)}")
        
        return True
        
    except Exception as e:
        print(f"✗ Error pushing to Supabase: {e}")
        return False

# Delete past events from table
def delete_past_events(table_name: str = "events_cessnock") -> bool:
    try:
        supabase = get_supabase_client()
        
        # Local datetime in ISO format, without timezone info
        now_local = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")

        print(f"Deleting events from '{table_name}' where start_date < {now_local} ...")

        supabase.table(table_name).delete().lt("start_date", now_local).execute()

        print("✓ Past events removed successfully.")
        return True

    except Exception as e:
        print(f"✗ Error removing past events: {e}")
        return False
