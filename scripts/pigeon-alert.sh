#!/bin/bash
# Pigeon ($Pigeon) breakeven alert
# Mint: 4fSWEw2wbYEUCcMtitzmeGUfqinoafXxkhqZrA9Gpump
# Pair: HiSBtzHFeFDADpUAhYDdftqJCAi3XzwsTYsDDHqfMjTJ
# Breakeven: $0.00385 / MC ~$3.87M

MINT="4fSWEw2wbYEUCcMtitzmeGUfqinoafXxkhqZrA9Gpump"
BREAKEVEN=0.00385
ENTRY_SOL=2.023

data=$(curl -s "https://api.dexscreener.com/latest/dex/tokens/$MINT" 2>/dev/null)
price=$(echo "$data" | jq -r '.pairs[0].priceUsd // empty' 2>/dev/null)
mcap=$(echo "$data" | jq -r '.pairs[0].marketCap // .pairs[0].fdv // empty' 2>/dev/null)

if [ -z "$price" ]; then
  echo "Failed to fetch price"
  exit 1
fi

echo "Pigeon price: \$$price | MC: \$$mcap | BE: \$$BREAKEVEN"

above=$(echo "$price >= $BREAKEVEN" | bc -l 2>/dev/null)
if [ "$above" = "1" ]; then
  pct=$(echo "scale=1; (($price - $BREAKEVEN) / $BREAKEVEN) * 100" | bc -l)
  echo "ALERT: Above breakeven by ${pct}%!"
  exit 0
else
  echo "Still below breakeven"
  exit 1
fi
