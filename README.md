This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Deployment

* SSG site deployed to Cloudflare Pages, no workers defined, so no server-side APIs are used

## Data refresh

* Every hour, the site's data is refreshed via `npm run fetch` via cron & Github Action
* see `.github/workflows/fetch.yml

## Data sources

* https://api.tzkt.io
* https://explorer.etherlink.com API

## Data reconciliation - withdrawals

* the target address is matched from both data sources
* then amts are matched on a first-in-first-out basis (FIFO)
* because there are many transfers of similar amts by an account (eg 100 xtz, often on the same date), with no obvious identifiers available to match specific transactions, this approach is a quick and dirty way to do reconciliation to flag up late/missing transfers.
* if an outbox ticket is missed or processed out of sequence, you still end up showing that an account is missing some tez, but the "wrong" withdrawal might be flagged if there are multiple transactions of same amt.

## License

* MIT