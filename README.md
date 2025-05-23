This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Deployment

- SSG site deployed to Cloudflare Pages, no workers defined, so no server-side APIs are used
- currently deployed to: https://etherlink-bridge-tracker.pages.dev/

## Data refresh

- Every hour, the site's data is refreshed via `npm run fetch` via cron & Github Action
- see `.github/workflows/fetch.yml`
- this checks in updated data, which in turn triggers a CF Pages deployment of `main` and updated data is made available to the website
- this approach is a workaround to avoid paying for vercel lol...

## Data sources

- https://api.tzkt.io
- https://explorer.etherlink.com API

## Data reconciliation - withdrawals

- the target address is matched from both data sources
- then xtz amounts are matched on a first-in-first-out basis (FIFO)
- etherlink amounts are floored to 6 decimal places because that's what tezos will send to the recipient. not sure what happens to the dust on etherlink, probably stuck there for ever.
- because there are many transfers of similar amts by an account (eg 100 xtz, often on the same date), with no obvious identifiers available to match specific transactions, this approach is a quick and dirty way to do reconciliation to flag up late/missing transfers.
- if an outbox ticket is missed or processed out of sequence, you still end up showing that an account is missing some tez, but the "wrong" withdrawal might be flagged if there are multiple transactions of same amt.
- Fast withdrawals are excluded from the main recs for now

## License

- MIT
