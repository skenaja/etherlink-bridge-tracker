## Future steps

- ~~decode the `payload` field on fast withdrawals~~ DONE: `decodePackedNat` in `src/lib/fastWithdrawalRecon.js` decodes the packed nat and cross-checks it against payout_amount (`payload_payout_mismatch`) and, on no-payout records, plausibility (`invalid_payload` — catches abi-style mis-encodings that fall back to the 14-day path); pre-production events exempt
- watch withdrawal_ids 29177 (pending, no LP pickup, ~14d old) and 29456 (5,000 XTZ, no LP pickup) — first candidates for initiated_stale
- fix pagination on the main-page fetch-blockscout.js txlist fetcher (known TODO) and consider migrating it to the Blockscout v2 API like fetch-etherlink-fast-logs.js

## Example fast withdrawal from relayer

https://tzkt.io/op4QQxxdod82m111QfZhbphkdqNvfWaDWQvMXWA8ooraMaC9VgY/160851867

```js
{
"withdrawal":
{
"content":
{
"nat":
"0",
"bytes":
null
},
"payload":
"0500964d",
"ticketer":
"KT1CeFqjJRJPNVvhvznQrWfHad2jCiDZ6Lyj",
"l2_caller":
"67386da035e4d888dcfbfca35c908b669fd4719f",
"timestamp":
"2025-05-15T20:12:31Z",
"full_amount":
"5000",
"withdrawal_id":
"645",
"base_withdrawer":
"tz1eHRgM4P7anQmBvBPf7yD9UZYt1cnX8ne9"
},
"payout_amount":
"4950",
"service_provider":
"tz1UgMVxk8hY4GhPFPB8BGT6Acke9TffHr34"
}
```
