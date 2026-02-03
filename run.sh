#!/bin/bash
cd "$(dirname "$0")"

# 기존 프로세스 종료
pkill -f 'tsx src/index.ts' 2>/dev/null
lsof -ti:4900 | xargs kill -9 2>/dev/null
sleep 1

# 백그라운드 실행
nohup pnpm dev > app.log 2>&1 &

sleep 2
PID=$(pgrep -f 'tsx src/index.ts')

if [ -n "$PID" ]; then
  echo "Started (PID: $PID)"
  echo "Log: $(pwd)/app.log"
else
  echo "Failed to start"
  tail -20 app.log
  exit 1
fi
