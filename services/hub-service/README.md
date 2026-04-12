# Hub Service

## Tests
**Coverage:** *88%*
The hub-service currently contains 14 automated tests focusing on security and traffic control. The CORS tests validate origin filtering, preflight OPTIONS handling and header management. The Rate Limiting tests verify that the "Redeem" endpoint correctly enforces a 10-request limit per IP address and properly clears restrictions after the timeout window.
### Commands
- Run Tests: `go test -v .`
- Coverage: `go test -cover .`