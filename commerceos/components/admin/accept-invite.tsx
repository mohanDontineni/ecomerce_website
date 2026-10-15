'use client';

import { useState } from 'react';
import { ArrowRight, Check, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PLATFORM_NAME } from '@/lib/branding';

export function AcceptInvite({ token }: { token: string }) {
  const [error, setError] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const passwordValue = form.get('password');
    const password = typeof passwordValue === 'string' ? passwordValue : '';
    if (password !== form.get('confirm')) {
      setError('Passwords do not match.');
      setLoading(false);
      return;
    }
    try {
      const response = await fetch('/api/team/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token,
          displayName: form.get('displayName'),
          password,
        }),
      });
      const result = (await response.json()) as { username?: string; error?: string };
      if (!response.ok || !result.username) throw new Error(result.error || 'Invite could not be accepted.');
      setUsername(result.username);
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : 'Invite could not be accepted.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="invite-accept-page">
      <a className="brand" href="/"><span className="brand-mark"><Sparkles /></span><span>{PLATFORM_NAME}</span></a>
      <section>
        {username ? (
          <>
            <span className="confirmation-mark"><Check /></span>
            <span className="kicker">Invitation accepted</span>
            <h1>You&apos;re on the team.</h1>
            <p>Your sign-in username is <strong>{username}</strong>. Keep it somewhere safe.</p>
            <Button render={<a href="/admin" />}>Open the control room <ArrowRight /></Button>
          </>
        ) : (
          <form onSubmit={submit}>
            <span className="auth-icon"><ShieldCheck /></span>
            <span className="kicker">Team invitation</span>
            <h1>Set up your staff account.</h1>
            <p>This invitation verifies your email. Choose a display name and a strong password to continue.</p>
            <div><Label htmlFor="invite-name">Display name</Label><Input id="invite-name" name="displayName" required /></div>
            <div><Label htmlFor="invite-password">Password</Label><Input id="invite-password" name="password" type="password" autoComplete="new-password" required /></div>
            <div><Label htmlFor="invite-confirm">Confirm password</Label><Input id="invite-confirm" name="confirm" type="password" autoComplete="new-password" required /></div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <Button size="lg" type="submit" disabled={loading || !token}>{loading ? 'Creating account…' : 'Accept invitation'} <ArrowRight /></Button>
          </form>
        )}
      </section>
    </main>
  );
}
