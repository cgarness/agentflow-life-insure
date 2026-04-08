import os
import urllib.request
import json
import ssl

def main():
    target_email = "cgarness.ffl@gmail.com"
    env_vars = {}
    with open(".env", "r") as f:
        for line in f:
            if "=" in line:
                key, val = line.strip().split("=", 1)
                env_vars[key] = val.strip('"').strip("'")
                
    url = env_vars.get("VITE_SUPABASE_URL")
    key = env_vars.get("SUPABASE_SERVICE_ROLE_KEY")
    
    if not url or not key:
        print("Missing URL or KEY")
        return

    admin_url = f"{url}/auth/v1/admin/users"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}"
    }
    
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    req = urllib.request.Request(admin_url, headers=headers)
    try:
        with urllib.request.urlopen(req, context=ctx) as response:
            data = json.loads(response.read().decode())
    except Exception as e:
        print("Failed to fetch users:", e)
        return
        
    users = data.get("users", [])
    if isinstance(data, list):
        users = data
        
    print(f"Found {len(users)} users.")
    deleted = 0
    has_target = False
    for u in users:
        uid = u.get("id")
        email = u.get("email")
        if email == target_email:
            print(f"Skipping: {email} ({uid})")
            has_target = True
            continue
            
        print(f"Deleting: {email} ({uid})")
        del_req = urllib.request.Request(f"{admin_url}/{uid}", headers=headers, method="DELETE")
        try:
            with urllib.request.urlopen(del_req, context=ctx) as res:
                deleted += 1
                print("Deleted successfully")
        except Exception as e:
            print(f"Failed to delete {uid}: {e}")
            
    print(f"Completed. Purged {deleted} users.")
    
if __name__ == "__main__":
    main()
