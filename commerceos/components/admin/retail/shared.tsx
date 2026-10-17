'use client';

import type { ReactNode } from 'react';
import { Boxes, CheckCircle2, CircleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { statusLabel } from './types';

export function RetailSectionHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
      <div>
        <span className="text-xs font-black uppercase tracking-[0.18em] text-primary">
          {eyebrow}
        </span>
        <h2 className="mt-2 text-3xl font-black tracking-[-0.05em] sm:text-4xl">
          {title}
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function RetailMetric({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: ReactNode;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <Card className="gap-0 py-0 shadow-[0_8px_30px_rgba(31,27,50,.04)]">
      <CardContent className="flex items-center gap-4 p-5">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700 [&_svg]:size-5">
          {icon}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          <strong className="mt-1 text-xl font-black">{value}</strong>
          <small className="truncate text-xs text-muted-foreground">
            {detail}
          </small>
        </span>
      </CardContent>
    </Card>
  );
}

export function RetailEmpty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="grid min-h-64 place-items-center content-center gap-3 rounded-2xl border border-dashed bg-card p-8 text-center">
      <span className="grid size-11 place-items-center rounded-xl bg-violet-100 text-primary">
        <Boxes className="size-5" />
      </span>
      <strong>{title}</strong>
      <p className="max-w-md text-sm leading-6 text-muted-foreground">
        {description}
      </p>
      {action ? (
        <Button size="sm" variant="outline" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}

export function RetailStatusBadge({ status }: { status: string }) {
  const successful = [
    'active',
    'open',
    'completed',
    'received',
    'captured',
    'valid',
  ].includes(status);
  const dangerous = [
    'failed',
    'cancelled',
    'voided',
    'refunded',
    'inactive',
    'error',
  ].includes(status);
  return (
    <Badge
      variant={dangerous ? 'destructive' : successful ? 'secondary' : 'outline'}
      className="capitalize"
    >
      {statusLabel(status)}
    </Badge>
  );
}

export function RetailFeedback({
  tone,
  children,
  className,
}: {
  tone: 'success' | 'error' | 'info';
  children: ReactNode;
  className?: string;
}) {
  const Icon = tone === 'success' ? CheckCircle2 : CircleAlert;
  return (
    <output
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      className={cn(
        'flex items-start gap-2 rounded-xl border px-4 py-3 text-sm',
        tone === 'error'
          ? 'border-destructive/25 bg-destructive/5 text-destructive'
          : tone === 'success'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
            : 'border-violet-200 bg-violet-50 text-violet-950',
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </output>
  );
}
