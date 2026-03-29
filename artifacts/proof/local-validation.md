# Gmail RL Local Validation

Base URL: http://127.0.0.1:61297

## Launch Commands
- cd deliveries/gmail-rl-6
- pnpm test
- pnpm typecheck
- pnpm validate:local
- pnpm start

## Validation Steps
- Reset the environment
- Create a draft
- Send the draft
- Star the sent thread
- Apply an important label
- Archive the sent thread
- Restore the seeded snapshot
- Verify snapshot growth and restore behavior

## Assertions
- Inbox threads before validation: 2
- Sent threads after send flow: 1
- Sent thread starred: true
- Labels before archive: sent, important
- Labels after archive: sent, important, archive
- Snapshot count observed: 63
- Restore snapshot id: snapshot-42
- Sent threads after restore: 0

JSON proof: /private/tmp/gmail-rl-delivery-20260329-6/artifacts/proof/local-validation.json