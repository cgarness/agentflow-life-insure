#!/bin/bash

# Extract keys directly from .env
URL=$(grep VITE_SUPABASE_URL .env | cut -d '"' -f 2)
KEY=$(grep SUPABASE_SERVICE_ROLE_KEY .env | cut -d '"' -f 2)
TARGET_EMAIL="cgarness.ffl@gmail.com"

echo "Using Supabase URL: $URL"

# Fetch all users (admin API)
RESPONSE=$(curl -s -X GET "$URL/auth/v1/admin/users" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY")

# Check if jq is available. If not, use some regex.
if command -v jq >/dev/null 2>&1; then
  echo "Using jq to parse users..."
  # Loop over all users
  USERS=$(echo "$RESPONSE" | jq -c '.users[]')
  
  if [ -z "$USERS" ]; then
    echo "No users found or error in response."
    false
  else
    echo "$USERS" | while read -r user; do
      id=$(echo "$user" | jq -r '.id')
      email=$(echo "$user" | jq -r '.email')
      
      if [ "$email" = "$TARGET_EMAIL" ]; then
        echo "Skipping Super Admin: $email ($id)"
      else
        echo "Deleting: $email ($id)"
        # Delete request
        curl -s -X DELETE "$URL/auth/v1/admin/users/$id" \
          -H "apikey: $KEY" \
          -H "Authorization: Bearer $KEY" > /dev/null
        echo "Deleted!"
      fi
    done
    echo "Done."
  fi
else
  echo "jq not found, using python to parse..."
  python3 -c "
import sys, json

try:
    data = json.loads(sys.stdin.read())
    users = data.get('users', data)
    if isinstance(users, dict) and 'users' not in users and 'id' in users: 
      # sometimes the response is a direct array or object depending on supabase version
      users = [users]
    if not isinstance(users, list):
       sys.exit(0)
except Exception as e:
    print('Failed to parse json', e)
    sys.exit(1)

for u in users:
    print(f\"{u.get('id')} {u.get('email')}\")
" <<< "$RESPONSE" | while read -r id email; do
    if [ "$email" = "$TARGET_EMAIL" ]; then
      echo "Skipping Super Admin: $email ($id)"
    elif [ -n "$id" ] && [ "$id" != "None" ]; then
      echo "Deleting: $email ($id)"
      curl -s -X DELETE "$URL/auth/v1/admin/users/$id" \
          -H "apikey: $KEY" \
          -H "Authorization: Bearer $KEY" > /dev/null
      echo "Deleted!"
    fi
  done
  echo "Done."
fi
