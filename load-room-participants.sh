#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-https://test-alpha-ashen-88.vercel.app}"
ROOM_ID="${ROOM_ID:-6043738c-71a7-476b-92f6-066134c6c204}"
ROOM_PASSWORD="${ROOM_PASSWORD:-1234}"
COUNT="${COUNT:-150}"

TEST_SLUG="${TEST_SLUG:-motivation-cards}"
ANSWERS_JSON="${ANSWERS_JSON:-[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}"

WORKDIR="${WORKDIR:-.load}"
COOKIES_DIR="$WORKDIR/cookies"
HEADERS_DIR="$WORKDIR/headers"
BODIES_DIR="$WORKDIR/bodies"
RESULTS_DIR="$WORKDIR/results"

mkdir -p "$COOKIES_DIR" "$HEADERS_DIR" "$BODIES_DIR" "$RESULTS_DIR"

echo "BASE=$BASE"
echo "ROOM_ID=$ROOM_ID"
echo "ROOM_PASSWORD=$ROOM_PASSWORD"
echo "COUNT=$COUNT"
echo "TEST_SLUG=$TEST_SLUG"
echo

echo "1) Creating participants..."
for i in $(seq 1 "$COUNT"); do
  NAME="Load User $i"
  BODY_FILE="$BODIES_DIR/join-$i.json"
  HEADER_FILE="$HEADERS_DIR/join-$i.headers"
  COOKIE_FILE="$COOKIES_DIR/user-$i.cookie"

  cat > "$BODY_FILE" <<JSON
{"room_id":"$ROOM_ID","name":"$NAME","password":"$ROOM_PASSWORD","personal_data_consent":true}
JSON

  curl --http1.1 -sS -D "$HEADER_FILE" -o /dev/null \
    -X POST "$BASE/api/training/rooms/join" \
    -H "Content-Type: application/json" \
    --data @"$BODY_FILE"

  COOKIE_LINE="$(grep -i '^set-cookie:' "$HEADER_FILE" | head -n 1 | sed 's/^set-cookie:[[:space:]]*//I' | cut -d';' -f1 || true)"

  if [ -z "$COOKIE_LINE" ]; then
    echo "JOIN_FAILED user=$i no Set-Cookie"
    exit 1
  fi

  echo "$COOKIE_LINE" > "$COOKIE_FILE"
  echo "JOIN_OK user=$i"
done

echo
echo "Participants created: $(find "$COOKIES_DIR" -type f | wc -l | tr -d ' ')"

echo
echo "2) Bootstrap load..."
: > "$RESULTS_DIR/bootstrap.txt"
for cookie_file in "$COOKIES_DIR"/*.cookie; do
  (
    COOKIE="$(cat "$cookie_file")"
    curl --http1.1 -sS \
      "$BASE/api/training/rooms/bootstrap?room_id=$ROOM_ID" \
      -H "Cookie: $COOKIE" \
      -o /dev/null -w "%{http_code}\n"
  ) >> "$RESULTS_DIR/bootstrap.txt" &
done
wait
echo "=== BOOTSTRAP ==="
sort "$RESULTS_DIR/bootstrap.txt" | uniq -c

echo
echo "3) Touch load..."
: > "$RESULTS_DIR/touch.txt"
for cookie_file in "$COOKIES_DIR"/*.cookie; do
  (
    COOKIE="$(cat "$cookie_file")"
    curl --http1.1 -sS -X POST \
      "$BASE/api/training/rooms/touch" \
      -H "Cookie: $COOKIE" \
      -H "Content-Type: application/json" \
      --data "{\"room_id\":\"$ROOM_ID\"}" \
      -o /dev/null -w "%{http_code}\n"
  ) >> "$RESULTS_DIR/touch.txt" &
done
wait
echo "=== TOUCH ==="
sort "$RESULTS_DIR/touch.txt" | uniq -c

echo
echo "4) Submit load..."
PAYLOAD_FILE="$BODIES_DIR/payload.json"
cat > "$PAYLOAD_FILE" <<JSON
{"room_id":"$ROOM_ID","test_slug":"$TEST_SLUG","answers":$ANSWERS_JSON}
JSON

: > "$RESULTS_DIR/submit.txt"
running=0
max_parallel=20

for cookie_file in "$COOKIES_DIR"/*.cookie; do
  (
    COOKIE="$(cat "$cookie_file")"
    curl --http1.1 -sS -X POST \
      "$BASE/api/training/attempts/submit" \
      -H "Cookie: $COOKIE" \
      -H "Content-Type: application/json" \
      --data @"$PAYLOAD_FILE" \
      -o /dev/null -w "%{http_code}\n"
  ) >> "$RESULTS_DIR/submit.txt" &

  running=$((running + 1))
  if [ "$running" -ge "$max_parallel" ]; then
    wait
    running=0
  fi
done
wait

echo "=== SUBMIT ==="
sort "$RESULTS_DIR/submit.txt" | uniq -c

echo
echo "Done."
echo "Artifacts saved in: $WORKDIR"