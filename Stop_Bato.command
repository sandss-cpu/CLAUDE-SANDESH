#!/bin/bash
# Double-click this file to stop Batoma on this Mac: the API (port 3000), the web server
# (5173) and the public website (4000), whichever copy started them. The database is left
# running, since other projects may use it.
set -u

for port in 3000 5173 4000; do
  for pid in $(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null); do
    # The API runs under `nest start --watch`, itself under `npm run start:dev`: stop those
    # too, or the watcher starts the API again on the next file change.
    victims="$pid"
    p="$pid"
    for _ in 1 2; do
      p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')"
      [ -n "$p" ] && [ "$p" -gt 1 ] || break
      case "$(ps -o command= -p "$p" 2>/dev/null)" in
        *"nest start"*|*"npm run start:dev"*) victims="$victims $p" ;;
        *) break ;;
      esac
    done
    kill $victims 2>/dev/null
  done
done

for _ in $(seq 1 10); do
  lsof -tiTCP:3000 -tiTCP:5173 -tiTCP:4000 -sTCP:LISTEN >/dev/null 2>&1 || break
  sleep 1
done

left=""
for port in 3000 5173 4000; do
  lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && left="$left $port"
done
if [ -z "$left" ]; then
  echo "Batoma is stopped (ports 3000, 5173 and 4000 are free)."
else
  echo "Still in use:$left. Something else may be using them; Activity Monitor shows what."
fi
read -r -p "Press return to close."
