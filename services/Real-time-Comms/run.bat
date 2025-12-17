@echo off
docker build -t signaling-service .
docker run -p 9001:9001 signaling-service
pause