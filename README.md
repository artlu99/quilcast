# Quilcast

A small Farcaster client that runs in the browser and talks straight to the [Hypersnap](https://hypersnap.org) network that Quilibrium runs. Reads hit the public node's HTTP API, writes are protobuf messages signed in the browser and posted to `/v1/submitMessage`, and keys live in `localStorage`. The only server is a tiny static host that also gives shared links proper previews.

Live at **[quilcast.com](https://quilcast.com)**.

## What it does

- Following and trending feeds (top-level casts), threads with their parent casts, profiles with separate casts and replies tabs
- Notifications: grouped likes, recasts and follows plus replies and mentions, with an unread dot
- Several accounts per browser, switched from the account menu (bottom left) or Settings
- Rich link previews (Open Graph and Farcaster mini app images) through `/api/unfurl`, and @mention autocomplete in the composer
- Search for people and for cast text
- Cast, reply, quote, like, recast, follow, delete your own casts, post into a channel
- Attach up to two photos or videos per cast. Photos are re-encoded in the browser (≤2048 px JPEG, no EXIF). Uploads go through `/api/upload` to Farcaster's CDN the way Quorum does it, using a 10-minute farcaster.xyz token the browser signs with your custody key. Farcaster only gives upload URLs to accounts that have a Warpcast signer, so other accounts' files are stored on the server and served from `/m/<hash>`
- HLS video plays natively where the browser supports it and through hls.js (loaded on first play) in Firefox-based browsers
- Create a new account: a recovery phrase is generated locally, you send about $0.20 of ETH on Optimism to it, and Quilcast registers the FID with `IdGateway.register`, adds a gasless Hypersnap signer (`KEY_ADD`) and claims your fname
- Sign in with an existing recovery phrase (the same derivation as Warpcast and Quorum, so phrases work across apps)
- Settings: profile (with photo upload), theme, recovery phrase and key export, node and Optimism RPC URLs, version

Channel pages aren't there because Hypersnap (and upstream Snapchain) can't list a channel's casts newest-first yet.

## How it fits together

| File | Role |
| --- | --- |
| `src/fc.ts` | Protobuf encoding, ed25519 message signing, EIP-712 (`KeyAdd`, `SignedKeyRequest`, fname proofs) |
| `src/eth.ts` | Optimism JSON-RPC, RLP and EIP-1559 signing for the one registration transaction |
| `src/api.ts` | Hypersnap reads and the locally stored account |
| `src/write.ts` | Signed writes, loaded on demand so readers don't download the crypto |
| `src/app.tsx`, `src/join.tsx` | Preact UI |
| `server/index.mjs` | Serves `dist/`, fills in meta tags for `/c/<hash>` and `/u/<name>`, renders 1200×630 cast cards at `/og/c/<hash>.png` with resvg, serves `/m/` uploads |
| `server/upload.mjs` | `/api/upload`: Farcaster CDN relay with a local fallback |
| `server/unfurl.mjs` | `/api/unfurl`: Open Graph metadata for link previews, public hosts only |

The message encoders are checked byte for byte against `@farcaster/core`, `viem` and Quilibrium's `quorum-shared`.

## Develop

```sh
npm install
PORT=3311 npm start   # API for uploads, after npm run build
npm run dev
npm test
npm run build && npm start   # production server on :3000
```

Your recovery phrase is stored unencrypted in this browser's `localStorage`. Anyone with access to your browser profile can take over the account, so treat it like a hot wallet.

Production runs from the `Dockerfile` on Easypanel.
