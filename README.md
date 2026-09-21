# Správa VPS

Dashboard pro správu produkčního VPS. Přístup je chráněný serverovou relací.

## Přihlášení

Před spuštěním vytvořte `.env.local`:

```dotenv
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=scrypt:<salt-v-hexu>:<hash-v-hexu>
AUTH_SECRET=vygenerujte-alespon-32-nahodnych-znaku
```

Heslo musí mít alespoň 12 znaků. Uložte pouze jeho salted `scrypt` hash ve formátu uvedeném výše, nikoli čitelné heslo.

Pro vygenerování tajemství v PowerShellu lze použít:

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
```

V produkci musí být aplikace dostupná pouze přes HTTPS. Přihlašovací cookie je `HttpOnly`, `SameSite=Strict` a vyprší po 8 hodinách.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
