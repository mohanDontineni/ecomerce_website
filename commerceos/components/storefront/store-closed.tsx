import { Sparkles } from 'lucide-react';

export function StoreClosed({ title }: { title: string }) {
  return (
    <main className="store-closed">
      <span className="brand-mark"><Sparkles /></span>
      <span className="kicker">Store update in progress</span>
      <h1>{title} will be right back.</h1>
      <p>The team is refreshing this storefront. Please check back shortly.</p>
      <a href="/admin">Store owner sign in</a>
    </main>
  );
}
