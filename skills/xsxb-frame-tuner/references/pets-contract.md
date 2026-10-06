# Optional Codex Pets adapter

Use only when the user selects or requests a Codex pet project. This asset format does not require the Agent itself to be Codex.

- Discover custom pets from `${CODEX_HOME:-$HOME/.codex}/pets` only for this requested adapter. Do not create pet storage as part of generic tool installation.
- Support `1536x1872` v1 and `1536x2288` v2 WebP atlases; each cell is `192x208`. V2 includes 16 look-direction frames.
- Installed built-in pets are read-only. Tuner-only transforms may be stored, but never write into the Codex application package.
- Requested custom pet saves may write `spritesheet.webp`; preserve the first source backup `spritesheet.xsxb-backup.webp`.
- Do not run engine sync, gameplay checks, or automatic box generation for pets.
- Report whether atlas dimensions, state mapping, and custom save/reload were actually verified. Absence of the Codex app only prevents discovery of its built-in pet assets.
