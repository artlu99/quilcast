# Quilcast

A small Farcaster client that runs in the browser and talks straight to the [Hypersnap](https://hypersnap.org) network that Quilibrium runs. Reads hit the public node's HTTP API, writes are protobuf messages signed in the browser and posted to `/v1/submitMessage`, and keys live in `localStorage`. The only server is a tiny static host that also gives shared links proper previews.

Live at **[quilcast.com](https://quilcast.com)**.

## What it does

- Trending and following feeds, threads, profiles
- Cast, reply, like, recast, follow, delete your own casts, edit your profile
- Create a new account: a recovery phrase is generated locally, you send about $0.20 of ETH on Optimism to it, and Quilcast registers the FID with `IdGateway.register`, adds a gasless Hypersnap signer (`KEY_ADD`) and claims your fname
- Sign in with an existing recovery phrase (the same derivation as Warpcast and Quorum, so phrases work across apps)
- Settings for the node URL, Optimism RPC and theme

## How it fits together

| File | Role |
| --- | --- |
| `src/fc.ts` | Protobuf encoding, ed25519 message signing, EIP-712 (`KeyAdd`, `SignedKeyRequest`, fname proofs) |
| `src/eth.ts` | Optimism JSON-RPC, RLP and EIP-1559 signing for the one registration transaction |
| `src/api.ts` | Hypersnap reads and the locally stored account |
| `src/write.ts` | Signed writes, loaded on demand so readers don't download the crypto |
| `src/app.tsx`, `src/join.tsx` | Preact UI |
| `server/index.mjs` | Serves `dist/`, fills in meta tags for `/c/<hash>` and `/u/<name>`, and renders 1200×630 cast cards at `/og/c/<hash>.png` with resvg |

The message encoders are checked byte for byte against `@farcaster/core`, `viem` and Quilibrium's `quorum-shared`.

## Develop

```sh
npm install
npm run dev
npm test
npm run build && npm start   # production server on :3000
```

Your recovery phrase is stored unencrypted in this browser's `localStorage`. Anyone with access to your browser profile can take over the account, so treat it like a hot wallet.

Production runs from the `Dockerfile` on Easypanel.
