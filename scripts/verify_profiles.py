import ssl
import urllib.request
import json

def main():
    env_vars = {}
    with open(".env", "r") as f:
        for line in f:
            if "=" in line:
                key, val = line.strip().split("=", 1)
                env_vars[key] = val.strip('"').strip("'")
                
    url = env_vars.get("VITE_SUPABASE_URL")
    key = env_vars.get("SUPABASE_SERVICE_ROLE_KEY") # Attempt with Service key
    
    if not url or not key:
        print("Missing URL or KEY")
        return

    # To query how many profiles are left
    profiles_url = f"{url}/rest/v1/profiles?select=email,role,id"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}"
    }
    
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    req = urllib.request.Request(profiles_url, headers=headers)
    try:
        with urllib.request.urlopen(req, context=ctx) as response:
            data = json.loads(response.read().decode())
            print("Row Count:", len(data))
            for p in data:
               print(f" - {p.get('email')} [{p.get('role')}]")
    except Exception as e:
        print("Failed to fetch profiles:", e)
        return
        
if __name__ == "__main__":
    main()
