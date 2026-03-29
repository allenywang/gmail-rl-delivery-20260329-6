# Gmail RL Vercel Validation

Base URL: https://gmail-rl-delivery-20260329-6.vercel.app

## Validation Steps
- Reset the deployed environment
- Create a draft
- Send the draft
- Star the sent thread
- Apply an important label
- Archive the sent thread
- Restore the seeded snapshot
- Verify snapshot restore behavior

## Assertions
- Inbox threads before validation: 2
- Sent threads after send flow: 1
- Sent threads after restore: 0
- Sent thread starred: true
- Labels before archive: sent, important
- Labels after archive: sent, important, archive
- Snapshot count observed: 7
- Restore snapshot id: snapshot-8
