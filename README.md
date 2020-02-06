# dfusion Safe test

This test creates multiple Safes owned by a master Safe, funds them with some token and then deposits some tokens to an exchange with 1 multi send tx via the master Safe.

### Testing it
- `npm install`
- `npm test`

### Notes
Currently this process can not be done via the web interface (gnosis-safe.io) as the interface does not allow to create `delegatecall` transactions, which is required to trigger multisend (batching transactions).