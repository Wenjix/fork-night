# Network and token marks

Network and token marks belong to their respective owners. Fork Night uses them to identify the networks and test currencies demonstrated in its rooms.

| Runtime asset | Official source |
| --- | --- |
| `public/brands/networks/solana.svg` | [Solana branding](https://solana.com/branding) |
| `public/brands/networks/monad.svg` | [Monad brand and media kit](https://monad.xyz/brand-and-media-kit) |
| `public/brands/networks/base.svg` | [Base core identifiers](https://brand.base.org/core-identifiers) |
| `public/brands/networks/tempo.svg` | [Tempo brand kit](https://tempo.xyz/brand/) |
| `public/brands/networks/usdc.svg` | [Circle brand kit](https://www.circle.com/pressroom#brandkit) |

The SVGs preserve the supplied geometry and colors. Tempo's empty export canvas is trimmed around its unchanged mark. The USDC token mark is displayed at least32px high, with a separate **test USDC** label. The other network labels explicitly identify Monad testnet, Solana devnet, Base Sepolia and Tempo Moderato testnet.

The marks identify networks and currencies; they do not designate Fork Night as an official product of these organizations. Source brand guidelines govern use of each mark. The application license does not grant ownership of these trademarks.

### Existing marks verified October 18, 2026

| Runtime asset | Verdict | Official source | Linked from | Fetched | Terms / usage | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| `public/brands/networks/monad.svg` | Byte-identical to official Monad logomark; no replacement. | `https://monad.xyz/brand-page-assets/Logomark.svg` | [Monad brand and media kit](https://monad.xyz/brand-and-media-kit) | 2026-10-18 | Use per Monad brand kit; keep supplied geometry and colors. | `32ab1d3ce7ce18e9c7531490c0bfe780d6f679702e88da0204df004ca83b34b9` |
| `public/brands/privy-symbol-black.svg` | Shape matches Privy's black brandmark in the official brand-guidelines page; no replacement. A direct static SVG file URL was not exposed by the page. | [Privy brand guidelines](https://www.privy.io/brand-guidelines) | [Privy brand guidelines](https://www.privy.io/brand-guidelines) | 2026-10-18 | Provide clear space, do not alter files, and do not display in a way that implies relationship, affiliation, or endorsement. | `889d082d9e935819f032f9721839084e1334363c93e087214ef9b53cc2efecb9` |


## Additional brand marks fetched October 18, 2026

These marks are stored as downloaded, unmodified files, and the UI shows them unaltered. The badges in `src/lib/brands.ts` use Kimi, MPP and x402 as wide logotypes on their own plate (Kimi and MPP on a light one, x402's wordmark, which has white letters, on a dark one), and Hunyuan, Phantom and MetaMask as square marks. The Kimi file is about 1 MB, so its image loads lazily. `public/brands/squads.svg` is the safety-zone diagram from the Squads brand page rather than the logo, so no badge uses it and Squads keeps a neutral tile until the logo file is added.

| Brand | Runtime asset | Format | Official source file | Linked from | Fetched | Terms / license | Usage notes | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Kimi (Moonshot AI) | `public/brands/kimi.svg` | SVG | `https://raw.githubusercontent.com/MoonshotAI/Branding-Guide/main/scenarios/01-kimi-with-icon/kimi-with-icon-light-solid.svg` | [MoonshotAI/Branding-Guide](https://github.com/MoonshotAI/Branding-Guide), [Kimi Brand Book](https://www.kimi.ai/resources/kimi-brand) | 2026-10-18 | [Kimi Logo Usage Terms](https://www.kimi.ai/policies/logo-usage-terms) | Moonshot AI owns the marks. Official lighter solid variant used; not optimized. Size changed from 1,087,477 bytes to 3,295 bytes. Rendered pixel diff vs the prior official full-gradient SVG: 2,571/22,272 pixels at 1x, 9,553/89,088 at 2x, 36,258/355,328 at 4x. | `6fdaab1c0ed0975c5503c0000ddd27eed5673a69018aa32e0b40258801c601a2` |
| Hunyuan (Tencent) | `public/brands/hunyuan.png` | PNG | `https://avatars.githubusercontent.com/u/210980732?v=4` | [Tencent-Hunyuan GitHub organization](https://github.com/Tencent-Hunyuan) | 2026-10-18 | No explicit Hunyuan brand-use terms found on the checked official GitHub organization/repositories; Tencent-Hunyuan/HunyuanOCR reports no SPDX license assertion through the GitHub API. | Official GitHub organization avatar only. Treat as Tencent-owned; use only for nominative identification, do not alter, and do not imply Tencent endorsement. This is the asset with the least explicit terms in this set. | `90db0495e4d538b565ef8392abb90dfc1a2fde4e4b15396db0507fc7d73bb291` |
| x402 | `public/brands/x402.svg` | SVG | `https://raw.githubusercontent.com/x402-foundation/x402/main/e2e/legacy/servers/typescript/http/next/app/assets/x402_wordmark_light.svg` | [x402-foundation/x402](https://github.com/x402-foundation/x402) | 2026-10-18 | [Apache-2.0](https://github.com/x402-foundation/x402/blob/main/LICENSE) for repository contents | Use as the official x402 wordmark from the current x402 foundation repository. Do not imply endorsement by x402 Foundation/Coinbase. | `bd807cfa9f7881c9e94fcc41ddabb1177d656626b982916c94340a9519d4b343` |
| MPP (Machine Payments Protocol) | `public/brands/mpp.svg` | SVG | `https://mpp.dev/logo-dark.svg` | [MPP brand page](https://mpp.dev/brand) | 2026-10-18 | [MPP brand page](https://mpp.dev/brand) usage guidelines | Use dark logo on light backgrounds and light logo on dark backgrounds. Keep clear space. Do not distort, recolor, rotate or redraw. Use avatar only for compact/social contexts. | `5a9a259b333e1b309ff57bf5309d2bda6c373073eccaae4d640b343c6adffd60` |
| Squads (Solana) | `public/brands/squads.png` | PNG | `https://avatars.githubusercontent.com/u/84348534?v=4` | [Squads-Protocol GitHub organization](https://github.com/Squads-Protocol), [Squads brand assets](https://squads.xyz/brand-assets) | 2026-10-18 | [Squads brand assets](https://squads.xyz/brand-assets) says all rights reserved | Official GitHub organization avatar used because the downloadable SVG found on the brand page was a safety-zone diagram, not a clean logo. Keep clear space per the brand page. | `7e0b8377ea24c89fdb9264127e8e214274c6fc4733d58ac62797bc4945514ed1` |
| MetaMask | `public/brands/metamask-fox.svg` | SVG | `https://images.ctfassets.net/clixtyxoaeas/1ezuBGezqfIeifWdVtwU4c/d970d4cdf13b163efddddd5709164d2e/MetaMask-icon-Fox.svg` | [MetaMask assets](https://metamask.io/assets) | 2026-10-18 | [MetaMask Terms of Use](https://metamask.io/terms-of-use) | MetaMask/Consensys owns its marks. Terms define MetaMask logos/designations as “Our Marks”; use only where permitted, do not alter, and do not imply sponsorship, endorsement or affiliation. Prior written consent may be required outside permitted contexts. | `5ddcb06dbeba86fc593af5d50032c6839088f3fb21c6e66514b8f16f210d8d0a` |
| Phantom | `public/brands/phantom.svg` | SVG | `https://mintcdn.com/phantom-e50e2e68/tU9g5MXFXgx4l6Em/resources/images/Phantom_SVG_Icon.svg?fit=max&auto=format&n=tU9g5MXFXgx4l6Em&q=85&s=7170eec10d9199f7766d6e4ccd1e56ff` | [Phantom logos and assets](https://docs.phantom.com/resources/assets) | 2026-10-18 | [Phantom Terms](https://phantom.com/terms) | Docs recommend this SVG/PNG icon for integrations and reference the style guide. Phantom terms say Phantom owns the PHANTOM and ghost-design marks; do not copy, imitate or use marks without prior written consent except as authorized, and do not imply endorsement or affiliation. | `2f238875a4b52e80eac9acfdd7e30bd9d81e7f8d13a3faff80cacd6cf413cddd` |

### No official mark found

| Brand | Result | Official URLs checked | Notes |
| --- | --- | --- | --- |
| ERC-8004 | No official mark added | [ethereum/ERCs](https://github.com/ethereum/ERCs), [ERC-8004 on eips.ethereum.org](https://eips.ethereum.org/EIPS/eip-8004), [erc-8004/erc-8004-contracts](https://github.com/erc-8004/erc-8004), [erc-8004/website_8004.org](https://github.com/erc-8004/website_8004.org), [Ethereum Magicians ERC-8004 call notes](https://ethereum-magicians.org/t/trustless-agents-erc-8004-call-1-september-23-2025/25487) | The canonical Ethereum ERCs/EIP pages provide the standard text, not a mark. The `erc-8004` org has a website image, but its terms and canonical status as the ERC-8004 mark were not clear enough to add under this task's requirements. |
